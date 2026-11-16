// In-memory stand-in for the GitHub REST API that lib/ghstore.js talks to (contents, git blobs,
// git refs). The tests pass {gh: mockGitHub()} to the handlers; its get/put/list go through the
// real adapter (createGhStore) and its fetch, so the request shapes are checked on every call.
//
//   files: Map path → {body: Buffer, sha}   (what's on the branch; tests read and edit it)
//   calls: {put, conflicts, get, requests}
//   beforePut(path): runs once, just before the next contents PUT is applied (simulate a race)
//   failNext: {status, headers, message} answers the next request (rate limits etc.)
//   branchExists: false → the branch is missing until the adapter creates it

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGhStore } from '../lib/ghstore.js';

export const TOKEN = 'ghp_test_token_never_logged';
const gitSha = (buf) => createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const b64lines = (buf) => buf.toString('base64').replace(/.{1,60}/g, '$&\n'); // GitHub wraps at 60

export function mockGitHub({ repo = 'ronanheal/CandCPlatform', branch = 'app-state', branchExists = true, cacheTtlMs = 0, now } = {}) {
  const files = new Map();
  const calls = { put: 0, conflicts: 0, get: 0, requests: 0, log: [] };
  const m = { files, calls, beforePut: null, failNext: null, branchExists, refsCreated: [] };

  const res = (status, body, headers = {}) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  m.fetch = async (url, init = {}) => {
    calls.requests++;
    const u = new URL(url);
    const method = init.method || 'GET';
    const h = init.headers || {};
    calls.log.push(`${method} ${u.pathname}${u.search}`);
    assert.equal(u.origin, 'https://api.github.com');
    assert.equal(h.authorization, `Bearer ${TOKEN}`);
    assert.equal(h['user-agent'], 'cc-platform');
    assert.equal(h['x-github-api-version'], '2022-11-28');
    assert.ok(['application/vnd.github+json', 'application/vnd.github.object+json'].includes(h.accept), h.accept);
    if (m.failNext) { const f = m.failNext; m.failNext = null; return res(f.status, { message: f.message || 'error' }, f.headers || {}); }
    const base = `/repos/${repo}`;
    const p = decodeURIComponent(u.pathname);
    if (method === 'GET' && p === base) return res(200, { full_name: repo, default_branch: 'main' });
    if (method === 'GET' && p === `${base}/git/ref/heads/main`) return res(200, { ref: 'refs/heads/main', object: { sha: 'f'.repeat(40), type: 'commit' } });
    if (method === 'GET' && p === `${base}/git/ref/heads/${branch}`) return m.branchExists ? res(200, { ref: `refs/heads/${branch}`, object: { sha: 'e'.repeat(40), type: 'commit' } }) : res(404, { message: 'Not Found' });
    if (method === 'POST' && p === `${base}/git/refs`) {
      const b = JSON.parse(init.body);
      assert.equal(b.ref, `refs/heads/${branch}`);
      assert.match(b.sha, /^[0-9a-f]{40}$/);
      if (m.branchExists) return res(422, { message: 'Reference already exists' });
      m.branchExists = true; m.refsCreated.push(b);
      return res(201, { ref: b.ref, object: { sha: b.sha } });
    }
    if (method === 'GET' && p.startsWith(`${base}/git/blobs/`)) {
      const sha = p.slice(`${base}/git/blobs/`.length);
      const f = [...files.values()].find((x) => x.sha === sha);
      if (!f) return res(404, { message: 'Not Found' });
      const fr = f.raw || f.body;
      return res(200, { sha, size: fr.length, encoding: 'base64', content: b64lines(fr) });
    }
    if (p.startsWith(`${base}/contents/`)) {
      const path = p.slice(`${base}/contents/`.length);
      if (method === 'GET') {
        calls.get++;
        assert.equal(u.searchParams.get('ref'), branch);
        if (!m.branchExists) return res(404, { message: `No commit found for the ref ${branch}` });
        const objectType = h.accept === 'application/vnd.github.object+json';
        const f = files.get(path);
        if (f) {
          const fr = f.raw || f.body;
          const big = fr.length > 1024 * 1024;
          // The default media type refuses files over 1 MB; the object one returns no content.
          if (big && !objectType) return res(403, { message: 'This API returns blobs up to 1 MB in size.', errors: [{ code: 'too_large' }] });
          return res(200, { type: 'file', name: path.split('/').pop(), path, sha: f.sha, size: fr.length, encoding: big ? 'none' : 'base64', content: big ? '' : b64lines(fr) });
        }
        const kids = [...files.keys()].filter((k) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/'));
        const entries = kids.map((k) => ({ type: 'file', name: k.split('/').pop(), path: k, sha: files.get(k).sha }));
        if (kids.length) return res(200, objectType ? { type: 'dir', name: path.split('/').pop(), path, entries } : entries);
        return res(404, { message: 'Not Found' });
      }
      if (method === 'PUT') {
        calls.put++;
        assert.equal(h['content-type'], 'application/json');
        const b = JSON.parse(init.body);
        assert.equal(typeof b.message, 'string');
        assert.ok(b.message.length > 0);
        assert.equal(b.branch, branch);
        assert.match(b.content, /^[A-Za-z0-9+/]*={0,2}$/);
        if (!m.branchExists) return res(404, { message: `Branch ${branch} not found` });
        if (m.beforePut) { const f = m.beforePut; m.beforePut = null; await f(path); }
        const cur = files.get(path);
        if (b.sha !== undefined) {
          if (!cur || cur.sha !== b.sha) { calls.conflicts++; return res(409, { message: `${path} does not match ${b.sha}` }); }
        } else if (cur) { calls.conflicts++; return res(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }); }
        // raw = what GitHub keeps; body = the decoded payload (ciphertext) tests inspect.
        const raw = Buffer.from(b.content, 'base64');
        const isText = raw.subarray(0, 6).toString('latin1') === 'CCB64:';
        const body = isText ? Buffer.from(raw.subarray(6).toString('ascii'), 'base64') : raw;
        const sha = gitSha(raw);
        files.set(path, { body, raw, sha });
        return res(cur ? 200 : 201, { content: { name: path.split('/').pop(), path, sha, size: raw.length }, commit: { sha: gitSha(Buffer.from(path + sha)), message: b.message } });
      }
    }
    return res(404, { message: 'Not Found' });
  };

  const store = createGhStore({ env: { GITHUB_STATE_TOKEN: TOKEN, STATE_REPO: repo, STATE_BRANCH: branch }, fetchImpl: m.fetch, cacheTtlMs, ...(now ? { now } : {}) });
  m.store = store;
  m.get = (...a) => store.get(...a);
  m.put = (...a) => store.put(...a);
  m.list = (...a) => store.list(...a);
  m.invalidate = (...a) => store.invalidate(...a);
  return m;
}
