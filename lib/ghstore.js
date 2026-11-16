// Server-side state storage on GitHub (replaces Vercel Blob): the account list, shared boards
// and check-ins live as files on a dedicated branch (default `app-state`) of this repo, written
// through the REST contents API. The bytes are whatever the caller gives us (the CCE1-encrypted
// files from lib/crypt.js), stored unchanged, so a file copied byte for byte from the old Blob
// store still decrypts.
//
// Env:
//   GITHUB_STATE_TOKEN  fine-grained PAT, Contents read/write on the state repo only (required)
//   STATE_REPO          owner/name (default ronanheal/CandCPlatform)
//   STATE_BRANCH        branch (default app-state). Created from the default branch's HEAD on the
//                       first write if it does not exist yet.
//
// Interface (what lib/store.js, lib/boards.js and lib/happiness.js use):
//   get(path, {fresh})              → {bytes: Buffer, sha} or null when the file doesn't exist
//   put(path, bytes, {sha, message}) → {sha}. Without sha: create only. With sha: update only if the
//                                     file is still at that sha. Otherwise throws err.conflict=true.
//   list(dir)                       → [{name, path, sha}] files directly in dir ([] when missing)
//
// Reads are cached per instance for ~30 s (cacheTtlMs); our own writes update the cache, and a
// conflict drops the entry. GitHub rate limiting (429, or 403 with the limit used up) becomes a
// 503 with retryAfter (seconds). The token is never logged or put into an error message.

export const DEFAULT_REPO = 'ronanheal/CandCPlatform';
export const DEFAULT_BRANCH = 'app-state';
const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const UA = 'cc-platform';

const fail = (msg, status, extra) => Object.assign(new Error(msg), { status }, extra || {});

// One URL path segment per path part, so ids can't escape the intended path.
const encPath = (p) => String(p).split('/').filter(Boolean).map(encodeURIComponent).join('/');

export function createGhStore({ env = process.env, fetchImpl, cacheTtlMs = 30_000, now = () => Date.now() } = {}) {
  const repo = String(env.STATE_REPO || DEFAULT_REPO);
  const branch = String(env.STATE_BRANCH || DEFAULT_BRANCH);
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const cache = new Map(); // path → {at, value}
  const inflight = new Map(); // path → Promise of a non-fresh read in progress
  let branchChecked = false;

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw fail('STATE_REPO is not owner/name', 503);

  function token() {
    const t = env.GITHUB_STATE_TOKEN;
    if (!t) throw fail('GITHUB_STATE_TOKEN is not configured', 503);
    return String(t);
  }

  async function call(method, url, { body, accept = 'application/vnd.github+json' } = {}) {
    const headers = {
      accept,
      authorization: `Bearer ${token()}`,
      'x-github-api-version': API_VERSION,
      'user-agent': UA,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let r;
    try {
      r = await doFetch(`${API}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch (e) {
      throw fail('State store unreachable', 503, { retryAfter: 10 });
    }
    let json = null;
    const text = await r.text();
    if (text) { try { json = JSON.parse(text); } catch (e) { json = null; } }
    return { status: r.status, ok: r.ok, headers: r.headers, json };
  }

  // 429, or 403 with the primary limit used up or a "secondary rate limit" message.
  function rateLimited(res) {
    const h = (k) => (res.headers && res.headers.get ? res.headers.get(k) : null);
    const msg = String((res.json && res.json.message) || '');
    if (!(res.status === 429 || (res.status === 403 && (h('x-ratelimit-remaining') === '0' || /rate limit/i.test(msg))))) return null;
    let secs = parseInt(h('retry-after'), 10);
    if (!(secs > 0)) {
      const reset = parseInt(h('x-ratelimit-reset'), 10);
      secs = reset > 0 ? Math.ceil(reset - now() / 1000) : 60;
    }
    return fail('Storage is busy, try again shortly', 503, { retryAfter: Math.min(3600, Math.max(5, secs || 60)), rateLimited: true });
  }

  function upstream(res, what) {
    const rl = rateLimited(res);
    if (rl) return rl;
    if (res.status === 401) return fail(`State store refused the token (${what})`, 503);
    if (res.status === 403) return fail(`State store: token lacks permission (${what})`, 503);
    return fail(`State store error ${res.status} (${what})`, 502);
  }

  // GitHub's contents API re-encodes BINARY content on update (it treats the bytes as text, so
  // an encrypted file's second version came back garbled). So files are stored as base64 TEXT
  // ("CCB64:" + base64) — plain ASCII GitHub has nothing to reinterpret. Reads still accept the
  // raw binary form ("CCE1…" ciphertext, e.g. copied from Blob) and plain JSON (boards/index.json).
  const TEXT_TAG = 'CCB64:';
  const toFile = (bytes) => {
    const b = Buffer.from(bytes);
    if (b.length >= 4 && b.subarray(0, 4).toString('latin1') === 'CCE1') return Buffer.from(TEXT_TAG + b.toString('base64'), 'ascii');
    return b; // plain text (e.g. the board index) is stored as is
  };
  const fromFile = (raw) => {
    const b = Buffer.from(raw);
    const head = b.subarray(0, TEXT_TAG.length).toString('latin1');
    if (head === TEXT_TAG) return Buffer.from(b.subarray(TEXT_TAG.length).toString('ascii').trim(), 'base64');
    return b;
  };

  async function getUncached(path) {
    // The "object" media type: works for files up to 100 MB (the default one refuses over 1 MB);
    // over 1 MB it returns the sha with content "" and encoding "none".
    const res = await call('GET', `/repos/${repo}/contents/${encPath(path)}?ref=${encodeURIComponent(branch)}`, { accept: 'application/vnd.github.object+json' });
    if (res.status === 404) return null; // no such file, or the branch doesn't exist yet
    if (!res.ok) throw upstream(res, 'read');
    const f = res.json;
    if (!f || Array.isArray(f) || f.type !== 'file' || !f.sha) throw fail('State store: not a file', 502);
    if (f.encoding === 'base64' && typeof f.content === 'string' && (f.content.length || !f.size)) {
      return { bytes: fromFile(Buffer.from(f.content, 'base64')), sha: f.sha };
    }
    // 1–100 MB: the contents API leaves content empty (encoding "none"). Fetch the git blob.
    const b = await call('GET', `/repos/${repo}/git/blobs/${encodeURIComponent(f.sha)}`);
    if (!b.ok) throw upstream(b, 'read blob');
    if (!b.json || b.json.encoding !== 'base64' || typeof b.json.content !== 'string') throw fail('State store: bad blob', 502);
    return { bytes: fromFile(Buffer.from(b.json.content, 'base64')), sha: f.sha };
  }

  async function get(path, { fresh = false } = {}) {
    const hit = cache.get(path);
    if (!fresh && hit && now() - hit.at < cacheTtlMs) return hit.value;
    // Concurrent reads of the same file (a page load fires many /api calls at once, each checking
    // the account list) share one request.
    if (!fresh && inflight.has(path)) return inflight.get(path);
    const p = getUncached(path).then((value) => { cache.set(path, { at: now(), value }); return value; });
    if (!fresh) { inflight.set(path, p); p.then(() => inflight.delete(path), () => inflight.delete(path)); }
    return p;
  }

  // Create the branch from the default branch's HEAD (once per instance, only when a write
  // finds it missing). Returns true when it now exists.
  async function ensureBranch() {
    const ref = await call('GET', `/repos/${repo}/git/ref/heads/${encPath(branch)}`);
    if (ref.ok) return false; // it exists: whatever failed was something else
    if (ref.status !== 404) throw upstream(ref, 'branch');
    const info = await call('GET', `/repos/${repo}`);
    if (!info.ok) throw upstream(info, 'repo');
    const def = info.json && info.json.default_branch;
    const head = await call('GET', `/repos/${repo}/git/ref/heads/${encPath(def)}`);
    if (!head.ok || !head.json || !head.json.object || !head.json.object.sha) throw upstream(head, 'default branch');
    const made = await call('POST', `/repos/${repo}/git/refs`, { body: { ref: `refs/heads/${branch}`, sha: head.json.object.sha } });
    if (made.ok || made.status === 422) return true; // 422: someone else just created it
    throw upstream(made, 'create branch');
  }

  async function put(path, bytes, { sha = null, message } = {}) {
    const body = {
      message: message || `state: update ${String(path).replace(/\.json\.enc$/, '')}`,
      content: toFile(bytes).toString('base64'),
      branch,
    };
    if (sha) body.sha = sha;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await call('PUT', `/repos/${repo}/contents/${encPath(path)}`, { body });
      if (res.ok) {
        const newSha = res.json && res.json.content && res.json.content.sha;
        cache.set(path, { at: now(), value: { bytes: Buffer.from(bytes), sha: newSha } });
        branchChecked = true;
        return { sha: newSha };
      }
      const rl = rateLimited(res);
      if (rl) throw rl;
      const msg = String((res.json && res.json.message) || '');
      // Missing branch: 404 (or a 422 that says so). Make it once, then try again.
      if (attempt === 0 && !branchChecked && (res.status === 404 || (res.status === 422 && /branch/i.test(msg)))) {
        branchChecked = true;
        if (await ensureBranch()) continue;
        throw upstream(res, 'write');
      }
      // 409: the file (or the branch head) moved since we read it. 422 about the sha: the file
      // exists but we sent no sha, or a sha it no longer has. Callers re-read, merge and retry.
      if (res.status === 409 || (res.status === 422 && /sha/i.test(msg))) {
        cache.delete(path);
        throw fail('Precondition failed: the file changed', 409, { conflict: true });
      }
      throw upstream(res, 'write');
    }
    throw fail('State store error (write)', 502);
  }

  async function list(dir) {
    const res = await call('GET', `/repos/${repo}/contents/${encPath(dir)}?ref=${encodeURIComponent(branch)}`);
    if (res.status === 404) return [];
    if (!res.ok) throw upstream(res, 'list');
    if (!Array.isArray(res.json)) return [];
    return res.json.filter((f) => f && f.type === 'file').map((f) => ({ name: f.name, path: f.path, sha: f.sha }));
  }

  return { repo, branch, get, put, list, invalidate: (p) => (p ? cache.delete(p) : cache.clear()) };
}

// The store for these options: opts.gh (tests) or one shared instance per env object.
const instances = new WeakMap();
export function ghStore(opts = {}) {
  if (opts.gh) return opts.gh;
  const env = opts.env || process.env;
  let s = instances.get(env);
  if (!s) { s = createGhStore({ env }); instances.set(env, s); }
  return s;
}

// A short, jittered pause before retrying after a conflict (GitHub serialises commits on a
// branch, so two saves at the same moment collide even on different files).
export const conflictPause = (attempt) => new Promise((r) => setTimeout(r, Math.round((50 + Math.random() * 100) * (attempt + 1))));

export const isConflict = (e) => !!(e && e.conflict);

// A read failure as the caller's own 503, keeping Retry-After from a rate limit.
export function unavailable(msg, e) {
  if (e && e.expose) return e;
  return fail(msg, 503, e && e.retryAfter ? { retryAfter: e.retryAfter } : undefined);
}
