// Tests for shared boards (/api/boards, lib/boards.js). No network: Vercel Blob is mocked.
// Run: node scripts/test_boards.mjs     (fixtures are made up — no real board content here)

import assert from 'node:assert/strict';
import * as A from '../lib/auth.js';
import * as C from '../lib/crypt.js';
import * as S from '../lib/store.js';
import * as B from '../lib/boards.js';
import { handle as boardsHandle } from '../api/boards.js';

const SECRET = 'x'.repeat(64);
const KEYHEX = 'b2'.repeat(32);
const KEY = Buffer.from(KEYHEX, 'hex');
const ORIGIN = 'https://cc.example.test';
const env = { SESSION_SECRET: SECRET, DATA_KEY: KEYHEX, ADMIN_EMAILS: 'owner@cc.test' };

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); }
}

class BlobNotFoundError extends Error {}
class BlobPreconditionFailedError extends Error {}
function mockBlob() {
  const files = new Map(); let n = 0; const calls = { put: 0, conflicts: 0 };
  const m = {
    files, calls, BlobNotFoundError, BlobPreconditionFailedError, beforePut: null,
    async get(path, o) {
      assert.equal(o.access, 'private');
      const f = files.get(path); if (!f) return null;
      return { statusCode: 200, stream: new Blob([f.body]).stream(), blob: { etag: f.etag } };
    },
    async put(path, body, o) {
      calls.put++;
      assert.equal(o.access, 'private');
      if (m.beforePut) { const f = m.beforePut; m.beforePut = null; await f(path); }
      const cur = files.get(path);
      if (o.ifMatch) { if (!cur || cur.etag !== o.ifMatch) { calls.conflicts++; throw new BlobPreconditionFailedError('Precondition failed'); } }
      else if (cur && !o.allowOverwrite) { calls.conflicts++; throw new Error('Vercel Blob: This blob already exists'); }
      files.set(path, { body: Buffer.from(body), etag: '"e' + (++n) + '"' });
      return { pathname: path };
    },
    async list({ prefix }) {
      return { blobs: [...files.keys()].filter((p) => p.startsWith(prefix)).map((pathname) => ({ pathname })), hasMore: false };
    },
  };
  return m;
}

const blob = mockBlob();
const O = { env, blob };
const users = [
  { email: 'owner@cc.test', name: 'Owner', pw: 'scrypt$x$ownerownerowner', admin: false },
  { email: 'ann@cc.test', name: 'Ann', pw: 'scrypt$x$annannannannann', admin: false },
  { email: 'boss@cc.test', name: 'Boss', pw: 'scrypt$x$bossbossbossbo', admin: true },
];
blob.files.set('auth/access.json.enc', { body: C.encryptJson({ users, requests: [] }, KEY), etag: '"a0"' });
S._resetCaches();
const cookieFor = async (u) => (await A.newSession(u, A.adminEmailSet(env), env)).cookies[0].split(';')[0];
const owner = await cookieFor(users[0]), ann = await cookieFor(users[1]), boss = await cookieFor(users[2]);

function req({ method = 'GET', cookie = '', body, origin = ORIGIN } = {}) {
  const h = new Headers();
  if (cookie) h.set('cookie', cookie);
  if (origin && method !== 'GET') h.set('origin', origin);
  if (body !== undefined) h.set('content-type', 'application/json');
  return new Request(ORIGIN + '/api/boards', { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const call = (o) => boardsHandle(req(o), O);
const getBoards = async (cookie) => (await (await call({ cookie })).json()).boards;

const T0 = Date.now() - 60_000;
const card = (id, title, updatedAt = T0, x = {}) => ({ id, type: 'card', title, updatedAt, ...x });
const board = (id, x = {}) => ({ id, v: 2, type: 'custom', name: 'Board ' + id, createdAt: T0, updatedAt: T0, columns: [
  { id: 'c1', name: 'One', cards: [card('k1', 'First'), card('k2', 'Second')] },
  { id: 'c2', name: 'Two', cards: [card('k3', 'Third')] },
], ...x });

console.log('auth');
await t('signed out: GET and PUT refused', async () => {
  assert.equal((await call({})).status, 401);
  assert.equal((await call({ method: 'PUT', body: { board: board('b1') } })).status, 401);
  assert.equal(blob.calls.put, 0);
});
await t('CSRF: foreign or missing Origin refused for writes', async () => {
  assert.equal((await call({ method: 'PUT', cookie: ann, origin: 'https://evil.test', body: { board: board('b1') } })).status, 403);
  assert.equal((await call({ method: 'POST', cookie: ann, origin: '', body: { board: board('b1') } })).status, 403);
  assert.equal(blob.calls.put, 0);
});
await t('bad method and bad board refused', async () => {
  assert.equal((await call({ method: 'DELETE', cookie: ann })).status, 405);
  assert.equal((await call({ method: 'PUT', cookie: ann, body: { board: { id: '../x', name: 'x' } } })).status, 400);
  assert.equal((await call({ method: 'PUT', cookie: ann, body: { board: { id: 'ok', name: '' } } })).status, 400);
});

console.log('save + read');
await t('a member saves a board; it is stored encrypted and everyone sees it', async () => {
  const r = await call({ method: 'PUT', cookie: ann, body: { board: { ...board('b1'), openedAt: 5, shared: true } } });
  assert.equal(r.status, 200);
  const saved = (await r.json()).board;
  assert.equal(saved.visibility, 'everyone');
  assert.equal(saved.openedAt, undefined, 'per-browser fields are not stored');
  const raw = blob.files.get('boards/b1.json.enc').body;
  assert.ok(!raw.toString('latin1').includes('First'), 'encrypted at rest');
  assert.deepEqual(C.decryptJson(raw, KEY).columns[0].cards.map((c) => c.id), ['k1', 'k2']);
  assert.deepEqual((await getBoards(owner)).map((b) => b.id), ['b1']);
});

console.log('admin-only visibility');
await t('a non-admin cannot create an admins-only board', async () => {
  const r = await call({ method: 'PUT', cookie: ann, body: { board: board('hr', { visibility: 'admins' }) } });
  assert.equal(r.status, 403);
  assert.equal(blob.files.has('boards/hr.json.enc'), false);
});
await t('an admin (ADMIN_EMAILS or access flag) creates one; non-admins cannot see it', async () => {
  assert.equal((await call({ method: 'PUT', cookie: owner, body: { board: board('hr', { visibility: 'admins' }) } })).status, 200);
  assert.deepEqual((await getBoards(ann)).map((b) => b.id).sort(), ['b1']);
  assert.deepEqual((await getBoards(owner)).map((b) => b.id).sort(), ['b1', 'hr']);
  assert.deepEqual((await getBoards(boss)).map((b) => b.id).sort(), ['b1', 'hr']);
});
await t('a non-admin cannot write to, or overwrite, an admins-only board', async () => {
  const before = blob.files.get('boards/hr.json.enc').etag;
  assert.equal((await call({ method: 'PUT', cookie: ann, body: { board: board('hr') } })).status, 403);
  assert.equal((await call({ method: 'PUT', cookie: ann, body: { board: board('hr', { visibility: 'admins' }) } })).status, 403);
  assert.equal(blob.files.get('boards/hr.json.enc').etag, before);
});
await t('a non-admin cannot change who sees a board; an admin can', async () => {
  const r = await call({ method: 'PUT', cookie: ann, body: { board: board('b1', { visibility: 'admins', visibilityAt: Date.now(), updatedAt: Date.now() }) } });
  assert.equal(r.status, 403);
  const ok = await call({ method: 'PUT', cookie: boss, body: { board: board('hr', { visibility: 'everyone', visibilityAt: Date.now(), updatedAt: Date.now() }) } });
  assert.equal((await ok.json()).board.visibility, 'everyone');
  assert.ok((await getBoards(ann)).some((b) => b.id === 'hr'));
  await call({ method: 'PUT', cookie: boss, body: { board: board('hr', { visibility: 'admins', visibilityAt: Date.now() + 1, updatedAt: Date.now() + 1 }) } });
  assert.ok(!(await getBoards(ann)).some((b) => b.id === 'hr'));
});

console.log('merge');
await t('stale save merges by card id: newest card wins, others kept, new cards from both', async () => {
  // Browser X (stale copy) edits k1 and adds k9; meanwhile browser Y already edited k2 and added k8.
  const now = Date.now();
  const y = board('m1', { updatedAt: now - 1000 });
  y.columns[0].cards[1] = card('k2', 'Second (edited by Y)', now - 1000);
  y.columns[1].cards.push(card('k8', 'New from Y', now - 1000));
  assert.equal((await call({ method: 'PUT', cookie: ann, body: { board: y } })).status, 200);
  const x = board('m1', { updatedAt: now });
  x.columns[0].cards[0] = card('k1', 'First (edited by X)', now);
  x.columns[0].cards.push(card('k9', 'New from X', now));
  const out = (await (await call({ method: 'PUT', cookie: owner, body: { board: x } })).json()).board;
  const all = Object.fromEntries(out.columns.flatMap((c) => c.cards.map((k) => [k.id, k.title])));
  assert.equal(all.k1, 'First (edited by X)');
  assert.equal(all.k2, 'Second (edited by Y)', 'stale copy did not undo Y');
  assert.ok(all.k8 && all.k9);
});
await t('a card moved in one browser and untouched in the other stays moved', async () => {
  const cur = (await getBoards(ann)).find((b) => b.id === 'm1');
  const moved = JSON.parse(JSON.stringify(cur));
  const k = moved.columns[0].cards.shift(); k.updatedAt = Date.now() + 10; moved.columns[1].cards.unshift(k); moved.updatedAt = Date.now() + 10;
  await call({ method: 'PUT', cookie: ann, body: { board: moved } });
  const stale = board('m1', { updatedAt: T0 });
  const out = (await (await call({ method: 'PUT', cookie: owner, body: { board: stale } })).json()).board;
  assert.equal(out.columns[1].cards[0].id, 'k1');
  assert.ok(!out.columns[0].cards.some((c) => c.id === 'k1'));
});
await t('deletes are tombstones: a stale copy does not bring a deleted card or column back', async () => {
  const now = Date.now() + 100;
  const cur = (await getBoards(ann)).find((b) => b.id === 'm1');
  const del = JSON.parse(JSON.stringify(cur));
  del.columns[0].cards = del.columns[0].cards.filter((c) => c.id !== 'k2');
  del.deleted = { k2: now }; del.updatedAt = now;
  await call({ method: 'PUT', cookie: ann, body: { board: del } });
  const out = (await (await call({ method: 'PUT', cookie: owner, body: { board: board('m1') } })).json()).board;
  assert.ok(!out.columns.some((c) => c.cards.some((k) => k.id === 'k2')));
  const colGone = JSON.parse(JSON.stringify(out)); colGone.columns = colGone.columns.filter((c) => c.id !== 'c2'); colGone.deleted.c2 = now + 1; colGone.updatedAt = now + 1;
  await call({ method: 'PUT', cookie: ann, body: { board: colGone } });
  const out2 = (await (await call({ method: 'PUT', cookie: owner, body: { board: board('m1') } })).json()).board;
  assert.deepEqual(out2.columns.map((c) => c.id), ['c1']);
});
await t('ETag conflict between read and write: re-read, merge, retry', async () => {
  const before = blob.calls.conflicts;
  const now = Date.now() + 1000;
  blob.beforePut = async (path) => {
    // Someone else's write lands between our read and our write.
    const other = B.mergeBoards(C.decryptJson(blob.files.get(path).body, KEY), { ...board('m1'), updatedAt: now, columns: [{ id: 'c1', name: 'One', cards: [card('kz', 'Racing write', now)] }] });
    blob.files.set(path, { body: C.encryptJson(other, KEY), etag: '"race"' });
  };
  const mine = board('m1', { updatedAt: now - 1 }); mine.columns[0].cards = [card('ky', 'My write', now - 1)];
  const r = await call({ method: 'PUT', cookie: ann, body: { board: mine } });
  assert.equal(r.status, 200);
  assert.equal(blob.calls.conflicts, before + 1);
  const ids = C.decryptJson(blob.files.get('boards/m1.json.enc').body, KEY).columns.flatMap((c) => c.cards.map((k) => k.id));
  assert.ok(ids.includes('kz') && ids.includes('ky'), 'both writes survive');
});
await t('creating the same new board twice at once: second create merges instead of clobbering', async () => {
  blob.beforePut = async (path) => {
    blob.files.set(path, { body: C.encryptJson(board('n1', { columns: [{ id: 'c1', name: 'One', cards: [card('a', 'A')] }] }), KEY), etag: '"other"' });
  };
  const r = await call({ method: 'PUT', cookie: ann, body: { board: board('n1', { columns: [{ id: 'c1', name: 'One', cards: [card('b', 'B')] }] }) } });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).board.columns[0].cards.map((c) => c.id).sort(), ['a', 'b']);
});
await t('removing a board hides it for everyone and a stale save does not revive it', async () => {
  await call({ method: 'PUT', cookie: ann, body: { board: board('b1', { removedAt: Date.now(), updatedAt: Date.now() }) } });
  assert.ok(!(await getBoards(owner)).some((b) => b.id === 'b1'));
  await call({ method: 'PUT', cookie: owner, body: { board: board('b1') } });
  assert.ok(!(await getBoards(owner)).some((b) => b.id === 'b1'));
});
await t('pure merge keeps column order and slots in a column only the older copy has', () => {
  const a = { id: 'x', name: 'x', updatedAt: 1, columns: [{ id: 'p', cards: [] }, { id: 'q', cards: [] }, { id: 'r', cards: [] }] };
  const b = { id: 'x', name: 'x', updatedAt: 2, columns: [{ id: 'r', cards: [] }, { id: 'p', cards: [] }] };
  assert.deepEqual(B.mergeBoards(a, b).columns.map((c) => c.id), ['r', 'p', 'q']);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
