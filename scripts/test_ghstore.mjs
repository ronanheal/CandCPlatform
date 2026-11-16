// Tests for the GitHub state store (lib/ghstore.js) and how the stores use it: request shapes,
// sha conflicts, branch auto-create, large files, rate limits, the board index, the read cache.
// No network: GitHub is mocked (scripts/mock_github.mjs).  Run: node scripts/test_ghstore.mjs

import assert from 'node:assert/strict';
import * as A from '../lib/auth.js';
import * as C from '../lib/crypt.js';
import * as S from '../lib/store.js';
import * as B from '../lib/boards.js';
import { createGhStore, ghUsage } from '../lib/ghstore.js';
import { handle as boardsHandle } from '../api/boards.js';
import { handle as healthHandle, assess } from '../api/health.js';
import { mockGitHub, TOKEN } from './mock_github.mjs';

const SECRET = 'x'.repeat(64);
const KEYHEX = 'c3'.repeat(32);
const KEY = Buffer.from(KEYHEX, 'hex');
const ORIGIN = 'https://cc.example.test';
const env = { SESSION_SECRET: SECRET, STORE_KEY: KEYHEX, ADMIN_EMAILS: 'owner@cc.test' };

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); }
}
const users = [
  { email: 'ann@cc.test', name: 'Ann', pw: 'scrypt$x$annannannannann', admin: false },
  { email: 'boss@cc.test', name: 'Boss', pw: 'scrypt$x$bossbossbossbo', admin: true },
];
const seedAccess = (gh) => { gh.files.set('auth/access.json.enc', { body: C.encryptJson({ users, requests: [] }, KEY), sha: 'a'.repeat(40) }); S._resetCaches(); };
const ann = (await A.newSession(users[0], A.adminEmailSet(env), env)).cookies[0].split(';')[0];
const boss = (await A.newSession(users[1], A.adminEmailSet(env), env)).cookies[0].split(';')[0];
function req({ method = 'GET', cookie = '', body, query = '' } = {}) {
  const h = new Headers();
  if (cookie) h.set('cookie', cookie);
  if (method !== 'GET') h.set('origin', ORIGIN);
  if (body !== undefined) h.set('content-type', 'application/json');
  return new Request(ORIGIN + '/api/boards' + query, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const T0 = Date.now() - 60_000;
const card = (id, title, updatedAt = T0) => ({ id, type: 'card', title, updatedAt });
const board = (id, cards = [card('k1', 'First')], x = {}) => ({ id, v: 2, type: 'custom', name: 'Board ' + id, createdAt: T0, updatedAt: T0, columns: [{ id: 'c1', name: 'One', cards }], ...x });
const annUser = { email: 'ann@cc.test', name: 'Ann', admin: false };
const index = (gh) => JSON.parse(gh.files.get('boards/index.json').body.toString('utf8')).ids;

console.log('adapter');
await t('put then get: same bytes back, sha from GitHub, request shapes as documented', async () => {
  const gh = mockGitHub();
  const bytes = C.encryptJson({ hello: 'world' }, KEY);
  const { sha } = await gh.put('auth/access.json.enc', bytes, { message: 'state: test' });
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.ok(gh.files.get('auth/access.json.enc').body.equals(bytes), 'stored byte for byte');
  assert.equal(gh.files.get('auth/access.json.enc').raw.subarray(0, 6).toString(), 'CCB64:', 'stored as base64 text (GitHub garbles binary on update)');
  const got = await gh.get('auth/access.json.enc');
  assert.ok(got.bytes.equals(bytes));
  assert.equal(got.sha, sha);
  assert.deepEqual(gh.calls.log, [
    'PUT /repos/ronanheal/CandCPlatform/contents/auth/access.json.enc',
    'GET /repos/ronanheal/CandCPlatform/contents/auth/access.json.enc?ref=app-state',
  ]);
  assert.equal(await gh.get('auth/nope.json.enc'), null, 'missing file → null');
});
await t('a file copied byte for byte from the old store still decrypts (same STORE_KEY)', async () => {
  const gh = mockGitHub();
  const oldBlobBytes = C.encryptJson({ users, requests: [] }, KEY); // what Vercel Blob held
  gh.files.set('auth/access.json.enc', { body: Buffer.from(oldBlobBytes), sha: 'b'.repeat(40) });
  S._resetCaches();
  const acc = await S.getAccess({ env, gh });
  assert.equal(acc.users.length, 2);
});
await t('conditional writes: create-only without sha, update-only with the current sha', async () => {
  const gh = mockGitHub();
  const { sha } = await gh.put('x/a.json.enc', Buffer.from('one'));
  await assert.rejects(gh.put('x/a.json.enc', Buffer.from('two')), (e) => e.conflict === true && e.status === 409);
  await assert.rejects(gh.put('x/a.json.enc', Buffer.from('two'), { sha: '0'.repeat(40) }), (e) => e.conflict === true);
  await gh.put('x/a.json.enc', Buffer.from('two'), { sha });
  assert.equal(gh.files.get('x/a.json.enc').body.toString(), 'two');
});
await t('large file (over 1 MB): read through the git blobs API', async () => {
  const gh = mockGitHub();
  const big = Buffer.alloc(1_300_000); for (let i = 0; i < big.length; i++) big[i] = (i * 7919) & 255;
  await gh.put('boards/big.json.enc', big);
  gh.calls.log.length = 0;
  const got = await gh.get('boards/big.json.enc');
  assert.ok(got.bytes.equals(big));
  assert.equal(gh.calls.log.length, 2);
  assert.match(gh.calls.log[1], /^GET \/repos\/ronanheal\/CandCPlatform\/git\/blobs\/[0-9a-f]{40}$/);
});
await t('missing branch: reads are empty; the first write creates it from the default branch HEAD', async () => {
  const gh = mockGitHub({ branchExists: false });
  assert.equal(await gh.get('auth/access.json.enc'), null);
  await gh.put('auth/access.json.enc', Buffer.from('CCE1-bytes'));
  assert.equal(gh.refsCreated.length, 1);
  assert.deepEqual(gh.refsCreated[0], { ref: 'refs/heads/app-state', sha: 'f'.repeat(40) });
  assert.ok(gh.files.has('auth/access.json.enc'));
  assert.ok(gh.calls.log.includes('POST /repos/ronanheal/CandCPlatform/git/refs'));
});
await t('first admin bootstrap works on an empty store with no branch yet', async () => {
  const gh = mockGitHub({ branchExists: false });
  S._resetCaches();
  const DK = 'd4'.repeat(32);
  const benv = { ...env, DATA_KEY: DK, ADMIN_EMAILS: 'owner@cc.test', BOOTSTRAP_TOKEN: 'setup-code-1234567890' };
  const { gzipSync } = await import('node:zlib');
  const usersEnc = C.encrypt(gzipSync(Buffer.from('[]')), Buffer.from(DK, 'hex'));
  const fetchImpl = async (url) => (String(url).endsWith('/users.json.enc') ? new Response(usersEnc) : new Response('', { status: 404 }));
  const { handle: authHandle } = await import('../api/auth/[action].js');
  const h = new Headers({ 'content-type': 'application/json', origin: ORIGIN });
  const r = await authHandle(new Request(ORIGIN + '/api/auth/request', { method: 'POST', headers: h, body: JSON.stringify({ name: 'Owner Person', email: 'owner@cc.test', token: 'setup-code-1234567890' }) }), { env: benv, gh, fetchImpl });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.ok(j.tempPassword || j.temp || j.password, 'temporary password shown once');
  const doc = C.decryptJson(gh.files.get('auth/access.json.enc').body, KEY);
  assert.equal(doc.users.length, 1);
  assert.equal(doc.users[0].email, 'owner@cc.test');
  assert.equal(gh.refsCreated.length, 1);
});
await t('rate limits → 503 with Retry-After (403 primary limit, 429 secondary)', async () => {
  const fixed = 1_800_000_000_000;
  const gh = mockGitHub({ now: () => fixed });
  gh.failNext = { status: 403, message: 'API rate limit exceeded', headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(fixed / 1000 + 120) } };
  await assert.rejects(gh.get('a.json.enc'), (e) => e.status === 503 && e.retryAfter === 120 && !String(e.message).includes(TOKEN));
  gh.failNext = { status: 429, headers: { 'retry-after': '30' } };
  await assert.rejects(gh.put('a.json.enc', Buffer.from('x')), (e) => e.status === 503 && e.retryAfter === 30);
  gh.failNext = { status: 403, message: 'You have exceeded a secondary rate limit' };
  await assert.rejects(gh.get('a.json.enc'), (e) => e.status === 503 && e.retryAfter === 60);
  gh.failNext = { status: 403, message: 'Resource not accessible by personal access token' };
  await assert.rejects(gh.get('a.json.enc'), (e) => e.status === 503 && !e.retryAfter);
});
await t('rate limit through the API: /api/boards answers 503 + Retry-After', async () => {
  const gh = mockGitHub(); seedAccess(gh);
  await S.getAccess({ env, gh }); // access list cached; the board read hits the limit
  gh.failNext = { status: 429, headers: { 'retry-after': '45' } };
  const r = await boardsHandle(req({ cookie: ann }), { env, gh });
  assert.equal(r.status, 503);
  assert.equal(r.headers.get('retry-after'), '45');
  S._resetCaches();
  gh.failNext = { status: 429, headers: { 'retry-after': '50' } };
  const r2 = await boardsHandle(req({ cookie: ann }), { env, gh }); // access list read limited
  assert.equal(r2.status, 503);
  assert.equal(r2.headers.get('retry-after'), '50');
});
await t('no token → 503 "not configured", and the token never appears in errors or logs', async () => {
  const s = createGhStore({ env: {}, fetchImpl: async () => { throw new Error('no network'); } });
  await assert.rejects(s.get('a'), (e) => e.status === 503 && /GITHUB_STATE_TOKEN/.test(e.message));
  const logs = []; const orig = console.error; console.error = (...a) => logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  try {
    const gh = mockGitHub(); seedAccess(gh);
    gh.failNext = { status: 500, message: 'boom' };
    await assert.rejects(gh.get('a'), (e) => !String(e.message).includes(TOKEN));
    gh.put = async () => { throw Object.assign(new Error('State store error 500 (write)'), { status: 502 }); };
    await assert.rejects(B.saveBoard(board('tk'), annUser, { env, gh }));
  } finally { console.error = orig; }
  assert.ok(!logs.join('\n').includes(TOKEN));
});
await t('read cache: ~30 s per instance, refreshed by our own writes, dropped on a conflict', async () => {
  let clock = 1_000_000;
  const gh = mockGitHub({ cacheTtlMs: 30_000, now: () => clock });
  await gh.put('c.json.enc', Buffer.from('v1'));
  const before = gh.calls.requests;
  assert.equal((await gh.get('c.json.enc')).bytes.toString(), 'v1', 'own write is in the cache');
  assert.equal(gh.calls.requests, before, 'no request');
  gh.files.set('c.json.enc', { body: Buffer.from('v2'), sha: '2'.repeat(40) }); // someone else wrote
  assert.equal((await gh.get('c.json.enc')).bytes.toString(), 'v1', 'still cached');
  assert.equal((await gh.get('c.json.enc', { fresh: true })).bytes.toString(), 'v2', 'fresh read bypasses');
  clock += 31_000;
  gh.files.set('c.json.enc', { body: Buffer.from('v3'), sha: '3'.repeat(40) });
  assert.equal((await gh.get('c.json.enc')).bytes.toString(), 'v3', 'expired after 30 s');
  await assert.rejects(gh.put('c.json.enc', Buffer.from('x'), { sha: '0'.repeat(40) }));
  const n = gh.calls.requests; await gh.get('c.json.enc'); assert.equal(gh.calls.requests, n + 1, 'conflict dropped the entry');
});

await t('concurrent reads of one file share a single request', async () => {
  const gh = mockGitHub({ cacheTtlMs: 30_000 });
  gh.files.set('auth/access.json.enc', { body: Buffer.from('abc'), sha: '1'.repeat(40) });
  const before = gh.calls.requests;
  const all = await Promise.all([1, 2, 3, 4, 5].map(() => gh.get('auth/access.json.enc')));
  assert.equal(gh.calls.requests, before + 1);
  assert.ok(all.every((r) => r.bytes.toString() === 'abc'));
});

console.log('stores on the adapter');
await t('sha conflict → re-read, merge and retry: two racing saves both keep their cards', async () => {
  const gh = mockGitHub(); seedAccess(gh);
  await B.saveBoard(board('race', [card('a', 'A')]), annUser, { env, gh });
  const now = Date.now();
  gh.beforePut = async () => { // another instance saves card b between our read and write
    await B.saveBoard({ ...board('race', [card('a', 'A'), card('b', 'B', now)]), updatedAt: now }, annUser, { env, gh });
  };
  const before = gh.calls.conflicts;
  await B.saveBoard({ ...board('race', [card('a', 'A'), card('c', 'C', now + 1)]), updatedAt: now + 1 }, annUser, { env, gh });
  assert.equal(gh.calls.conflicts, before + 1);
  const ids = C.decryptJson(gh.files.get('boards/race.json.enc').body, KEY).columns[0].cards.map((k) => k.id).sort();
  assert.deepEqual(ids, ['a', 'b', 'c']);
});
await t('account list: concurrent change → retried, both changes kept', async () => {
  const gh = mockGitHub(); seedAccess(gh);
  const realPut = gh.put; let first = true;
  gh.put = async (p, b, o) => {
    if (first) { first = false; await S.mutateAccess((d) => ({ ...d, requests: [...d.requests, { email: 'x@cc.test' }] }), 'm', { env, gh: { ...gh, put: realPut } }); }
    return realPut(p, b, o);
  };
  await S.mutateAccess((d) => ({ ...d, requests: [...d.requests, { email: 'y@cc.test' }] }), 'm', { env, gh });
  const doc = C.decryptJson(gh.files.get('auth/access.json.enc').body, KEY);
  assert.deepEqual(doc.requests.map((r) => r.email).sort(), ['x@cc.test', 'y@cc.test']);
});
await t('board index: created on the first board, added to on create, kept on remove', async () => {
  const gh = mockGitHub(); seedAccess(gh);
  await B.saveBoard(board('i1'), annUser, { env, gh });
  assert.deepEqual(index(gh), ['i1']);
  await B.saveBoard(board('i2'), annUser, { env, gh });
  assert.deepEqual(index(gh), ['i1', 'i2']);
  const puts = gh.calls.put;
  await B.saveBoard({ ...board('i1', [card('k1', 'First'), card('k9', 'More', Date.now())]), updatedAt: Date.now() }, annUser, { env, gh });
  assert.equal(gh.calls.put, puts + 1, 'an update of a listed board writes only the board');
  await B.saveBoard({ ...board('i2'), removedAt: Date.now(), updatedAt: Date.now() }, annUser, { env, gh });
  assert.deepEqual(index(gh), ['i1', 'i2'], 'removal is a soft delete: still indexed');
  assert.deepEqual((await B.listBoards(annUser, { env, gh })).map((b) => b.id), ['i1']);
  assert.deepEqual((await B.listBoards({ ...annUser, admin: true }, { env, gh, removed: true })).map((b) => b.id), ['i2']);
});
await t('listing reads the index, not the directory (one read + one per board)', async () => {
  const gh = mockGitHub(); seedAccess(gh);
  for (const id of ['l1', 'l2', 'l3']) await B.saveBoard(board(id), annUser, { env, gh });
  gh.calls.log.length = 0;
  const list = await B.listBoards(annUser, { env, gh });
  assert.equal(list.length, 3);
  assert.equal(gh.calls.log.length, 4);
  assert.equal(gh.calls.log[0], 'GET /repos/ronanheal/CandCPlatform/contents/boards/index.json?ref=app-state');
});
await t('no index yet (files copied from Blob): listing falls back to the directory; next save writes the index', async () => {
  const gh = mockGitHub(); seedAccess(gh);
  for (const id of ['m1', 'm2']) gh.files.set(`boards/${id}.json.enc`, { body: C.encryptJson({ ...board(id), createdBy: 'ann@cc.test' }, KEY), sha: id.padEnd(40, '0') });
  assert.deepEqual((await B.listBoards(annUser, { env, gh })).map((b) => b.id).sort(), ['m1', 'm2']);
  assert.equal(gh.files.has('boards/index.json'), false, 'a read never writes');
  await B.saveBoard(board('m3'), annUser, { env, gh });
  assert.deepEqual(index(gh), ['m1', 'm2', 'm3']);
});
await t('index self-heals: a board missing from the index is added on its next save', async () => {
  const gh = mockGitHub(); seedAccess(gh);
  await B.saveBoard(board('h1'), annUser, { env, gh });
  gh.files.set('boards/index.json', { body: B.indexBytes([]), sha: '9'.repeat(40) });
  await B.saveBoard({ ...board('h1', [card('k1', 'First'), card('k2', 'x', Date.now())]), updatedAt: Date.now() }, annUser, { env, gh });
  assert.deepEqual(index(gh), ['h1']);
});
await t('a re-sent unchanged board is not written again (no commit)', async () => {
  const gh = mockGitHub(); seedAccess(gh);
  await B.saveBoard(board('n1'), annUser, { env, gh });
  const puts = gh.calls.put;
  const r = await boardsHandle(req({ method: 'PUT', cookie: ann, body: { board: board('n1') } }), { env, gh });
  assert.equal(r.status, 200);
  assert.equal(gh.calls.put, puts);
});
await t('admin restore goes through the adapter with the read sha', async () => {
  const gh = mockGitHub(); seedAccess(gh);
  await B.saveBoard(board('r1'), annUser, { env, gh });
  await B.saveBoard({ ...board('r1'), removedAt: Date.now(), updatedAt: Date.now() }, annUser, { env, gh });
  const r = await boardsHandle(req({ method: 'POST', cookie: boss, body: { action: 'restore', id: 'r1' } }), { env, gh });
  assert.equal(r.status, 200);
  assert.equal(C.decryptJson(gh.files.get('boards/r1.json.enc').body, KEY).removedAt, undefined);
});

console.log('migration (scripts/migrate_blob_to_github.mjs)');
const { migrate } = await import('./migrate_blob_to_github.mjs');
function fakeBlob(map) {
  const ops = { list: 0, get: 0 };
  return {
    ops,
    async list({ cursor }) { ops.list++; assert.equal(cursor, undefined); return { blobs: [...map.keys()].map((pathname) => ({ pathname })), hasMore: false }; },
    async get(p, o) { ops.get++; assert.equal(o.access, 'private'); const b = map.get(p); return b ? { statusCode: 200, stream: new Blob([b]).stream() } : null; },
  };
}
const oldFiles = () => new Map([
  ['auth/access.json.enc', C.encryptJson({ users, requests: [] }, KEY)],
  ['boards/ob1.json.enc', C.encryptJson({ ...board('ob1'), createdBy: 'ann@cc.test' }, KEY)],
  ['boards/ob2.json.enc', C.encryptJson({ ...board('ob2'), createdBy: 'ann@cc.test' }, KEY)],
  ['happiness/2026.json.enc', C.encryptJson({ v: 1, responses: {} }, KEY)],
  ['other/ignored.txt', Buffer.from('x')],
]);
const quiet = () => {};
await t('dry run: reads only, writes nothing', async () => {
  const gh = mockGitHub(); const bl = fakeBlob(oldFiles());
  const done = await migrate({ blob: bl, gh, dry: true, log: quiet });
  assert.equal(done.copied, 4);
  assert.equal(gh.calls.put, 0);
  assert.equal(gh.files.size, 0);
  assert.equal(bl.ops.list, 1, 'one Blob list call');
});
await t('copies the same bytes, builds the index, and the app reads them with the same key', async () => {
  const gh = mockGitHub({ branchExists: false }); const src = oldFiles();
  const done = await migrate({ blob: fakeBlob(src), gh, log: quiet });
  assert.deepEqual(done, { copied: 4, same: 0, skipped: 0, failed: 0 });
  for (const p of ['auth/access.json.enc', 'boards/ob1.json.enc', 'boards/ob2.json.enc', 'happiness/2026.json.enc']) assert.ok(gh.files.get(p).body.equals(src.get(p)), p);
  assert.equal(gh.files.has('other/ignored.txt'), false);
  assert.deepEqual(index(gh), ['ob1', 'ob2']);
  S._resetCaches();
  assert.deepEqual((await B.listBoards(annUser, { env, gh })).map((b) => b.id), ['ob1', 'ob2']);
  assert.equal((await S.getAccess({ env, gh })).users.length, 2);
  const again = await migrate({ blob: fakeBlob(src), gh, log: quiet });
  assert.equal(again.same, 4, 'second run: nothing to do');
});
await t('an account list made on GitHub after the outage is not overwritten without --overwrite', async () => {
  const gh = mockGitHub(); const src = oldFiles();
  const fresh = C.encryptJson({ users: [users[1]], requests: [] }, KEY);
  gh.files.set('auth/access.json.enc', { body: fresh, sha: '7'.repeat(40) });
  const done = await migrate({ blob: fakeBlob(src), gh, log: quiet });
  assert.equal(done.skipped, 1);
  assert.ok(gh.files.get('auth/access.json.enc').body.equals(fresh));
  await migrate({ blob: fakeBlob(src), gh, overwrite: true, log: quiet });
  assert.ok(gh.files.get('auth/access.json.enc').body.equals(src.get('auth/access.json.enc')));
});

console.log('usage watch');
const healthReq = (cookie = '', method = 'GET') => { const h = new Headers(); if (cookie) h.set('cookie', cookie); if (method !== 'GET') h.set('origin', ORIGIN); return new Request(ORIGIN + '/api/health', { method, headers: h }); };
const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
await t('the mock sends x-ratelimit-* headers like GitHub', async () => {
  const gh = mockGitHub();
  const r = await gh.fetch('https://api.github.com/repos/ronanheal/CandCPlatform', { headers: { authorization: `Bearer ${TOKEN}`, 'user-agent': 'cc-platform', 'x-github-api-version': '2022-11-28', accept: 'application/vnd.github+json' } });
  assert.equal(r.headers.get('x-ratelimit-limit'), '5000');
  assert.equal(r.headers.get('x-ratelimit-remaining'), '4999');
  assert.equal(r.headers.get('x-ratelimit-used'), '1');
  assert.match(r.headers.get('x-ratelimit-reset'), /^\d+$/);
});
await t('adapter remembers the last rate-limit headers and counts calls and writes', async () => {
  const gh = mockGitHub();
  assert.equal(gh.usage().store.limit, null, 'nothing seen yet');
  await gh.put('x/a.json.enc', Buffer.from('one'));
  await gh.get('x/a.json.enc');
  await gh.get('x/b.json.enc');
  const u = ghUsage({ gh });
  assert.equal(u.store.limit, 5000);
  assert.equal(u.store.remaining, 4997);
  assert.equal(u.store.used, 3);
  assert.equal(u.store.usedPct, 0.1);
  assert.equal(u.store.remainingPct, 99.9);
  assert.ok(u.store.reset > Date.now() / 1000);
  assert.deepEqual([u.instance.calls, u.instance.writes], [3, 1]);
  assert.ok(!Number.isNaN(Date.parse(u.instance.since)));
  assert.equal(u.rateLimitedAt, null);
});
await t('instance counts start again each hour', async () => {
  let clock = 1_800_000_000_000;
  const gh = mockGitHub({ now: () => clock });
  await gh.put('x/a.json.enc', Buffer.from('one'));
  await gh.get('x/a.json.enc');
  assert.equal(gh.usage().instance.calls, 2);
  clock += 3_600_001;
  assert.deepEqual([gh.usage().instance.calls, gh.usage().instance.writes], [0, 0]);
  await gh.get('x/a.json.enc');
  assert.equal(gh.usage().instance.calls, 1);
  assert.equal(gh.usage().instance.since, new Date(clock).toISOString());
});
await t('a rate-limited answer is remembered', async () => {
  const gh = mockGitHub();
  gh.failNext = { status: 429, headers: { 'retry-after': '30' } };
  await assert.rejects(gh.get('x/a.json.enc'), (e) => e.retryAfter === 30);
  assert.ok(Date.now() - gh.usage().rateLimitedAt < 1000);
});
await t('state commits in 7 days: one request (Link header), since= sent, cached 10 minutes', async () => {
  let clock = Date.now();
  const gh = mockGitHub({ now: () => clock });
  gh.commits = [...Array(250)].map((_, i) => ({ date: daysAgo(i % 6) })).concat([...Array(40)].map(() => ({ date: daysAgo(9) })));
  assert.equal(await gh.stateCommits(7), 250);
  assert.equal(gh.calls.requests, 1);
  assert.match(gh.calls.log[0], /^GET \/repos\/ronanheal\/CandCPlatform\/commits\?sha=app-state&since=[^&]+&per_page=1$/);
  gh.commits.push({ date: daysAgo(0) });
  assert.equal(await gh.stateCommits(7), 250, 'cached');
  clock += 600_001;
  assert.equal(await gh.stateCommits(7), 251, 'refreshed after 10 minutes');
  assert.equal(gh.calls.requests, 2);
  const one = mockGitHub(); one.commits = [{ date: daysAgo(1) }];
  assert.equal(await one.stateCommits(7), 1, 'no Link header: count the page');
  assert.equal(await mockGitHub({ branchExists: false }).stateCommits(7), 0, 'no branch yet');
});
await t('/api/health: admins only, GET only', async () => {
  const gh = mockGitHub(); seedAccess(gh);
  assert.equal((await healthHandle(healthReq(), { env, gh })).status, 401);
  assert.equal((await healthHandle(healthReq(ann), { env, gh })).status, 403);
  assert.equal((await healthHandle(healthReq(boss, 'POST'), { env, gh })).status, 405);
});
await t('/api/health: shape and ok when quiet', async () => {
  const gh = mockGitHub(); seedAccess(gh);
  gh.commits = [{ date: daysAgo(1) }, { date: daysAgo(2) }];
  const r = await healthHandle(healthReq(boss), { env, gh });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const b = await r.json();
  assert.equal(b.status, 'ok'); assert.equal(b.ok, true); assert.equal(b.warn, false); assert.equal(b.alert, false);
  assert.equal(b.store.limit, 5000);
  assert.ok(b.store.remaining > 4990);
  assert.equal(typeof b.store.usedPct, 'number');
  assert.ok(!Number.isNaN(Date.parse(b.store.reset)), 'reset as an ISO date');
  assert.ok(b.instance.calls >= 2, 'access list read + commits');
  assert.equal(typeof b.instance.writes, 'number');
  assert.ok(b.instance.since);
  assert.equal(b.stateCommits7d, 2);
  assert.ok(!JSON.stringify(b).includes(TOKEN), 'token never in the answer');
});
await t('/api/health: warn under 25% left or over 2,000 commits a week', async () => {
  const gh = mockGitHub(); seedAccess(gh);
  gh.rate.remaining = 1100; // 1100 - 2 requests → ~21.9%
  let b = await (await healthHandle(healthReq(boss), { env, gh })).json();
  assert.equal(b.status, 'warn'); assert.equal(b.warn, true);
  assert.match(b.reasons.join(' '), /allowance left/);
  const busy = mockGitHub(); seedAccess(busy);
  busy.commits = [...Array(2001)].map(() => ({ date: daysAgo(3) }));
  b = await (await healthHandle(healthReq(boss), { env, gh: busy })).json();
  assert.equal(b.stateCommits7d, 2001);
  assert.equal(b.status, 'warn');
  assert.match(b.reasons.join(' '), /2001 state saves/);
});
await t('/api/health: alert under 10% left or after a rate-limited answer', async () => {
  const gh = mockGitHub(); seedAccess(gh);
  gh.rate.remaining = 400;
  let b = await (await healthHandle(healthReq(boss), { env, gh })).json();
  assert.equal(b.status, 'alert'); assert.equal(b.alert, true); assert.equal(b.ok, false);
  const hit = mockGitHub(); seedAccess(hit);
  await S.getAccess({ env, gh: hit }); // warm the access cache so the health call gets through
  hit.failNext = { status: 403, message: 'You have exceeded a secondary rate limit' };
  b = await (await healthHandle(healthReq(boss), { env, gh: hit })).json();
  assert.equal(b.status, 'alert');
  assert.ok(b.rateLimitedAt);
  assert.equal(b.stateCommits7d, null);
  assert.equal(b.commitsError, 'Storage is busy');
});
await t('assess: thresholds and the one-hour rate-limit window', async () => {
  const n = 1_800_000_000_000;
  assert.equal(assess({ store: { remainingPct: 25 }, stateCommits7d: 2000 }, n).status, 'ok');
  assert.equal(assess({ store: { remainingPct: 24.9 } }, n).status, 'warn');
  assert.equal(assess({ store: { remainingPct: 9.9 } }, n).status, 'alert');
  assert.equal(assess({ store: { remainingPct: null } }, n).status, 'ok', 'nothing seen yet');
  assert.equal(assess({ store: {}, rateLimitedAt: n - 3_599_000 }, n).status, 'alert');
  assert.equal(assess({ store: {}, rateLimitedAt: n - 3_601_000 }, n).status, 'ok');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
