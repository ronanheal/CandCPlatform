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
  { email: 'cat@cc.test', name: 'Cat', pw: 'scrypt$x$catcatcatcatca', admin: false },
];
blob.files.set('auth/access.json.enc', { body: C.encryptJson({ users, requests: [] }, KEY), etag: '"a0"' });
S._resetCaches();
const cookieFor = async (u) => (await A.newSession(u, A.adminEmailSet(env), env)).cookies[0].split(';')[0];
const owner = await cookieFor(users[0]), ann = await cookieFor(users[1]), boss = await cookieFor(users[2]), cat = await cookieFor(users[3]);

function req({ method = 'GET', cookie = '', body, origin = ORIGIN, query = '' } = {}) {
  const h = new Headers();
  if (cookie) h.set('cookie', cookie);
  if (origin && method !== 'GET') h.set('origin', origin);
  if (body !== undefined) h.set('content-type', 'application/json');
  return new Request(ORIGIN + '/api/boards' + query, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
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
await t('the creator is recorded server-side and cannot be forged', async () => {
  const stored = C.decryptJson(blob.files.get('boards/b1.json.enc').body, KEY);
  assert.equal(stored.createdBy, 'ann@cc.test');
  await call({ method: 'PUT', cookie: cat, body: { board: board('b1', { createdBy: 'cat@cc.test', updatedAt: Date.now() }) } });
  assert.equal(C.decryptJson(blob.files.get('boards/b1.json.enc').body, KEY).createdBy, 'ann@cc.test');
  const nb = (await (await call({ method: 'PUT', cookie: cat, body: { board: board('c1x', { createdBy: 'ann@cc.test' }) } })).json()).board;
  assert.equal(nb.createdBy, 'cat@cc.test');
});
await t('only the creator or an admin can remove a board', async () => {
  const before = blob.files.get('boards/b1.json.enc').etag;
  const r = await call({ method: 'PUT', cookie: cat, body: { board: board('b1', { removedAt: Date.now(), updatedAt: Date.now() }) } });
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /created this board, or an admin/);
  assert.equal(blob.files.get('boards/b1.json.enc').etag, before);
  assert.ok((await getBoards(cat)).some((b) => b.id === 'b1'));
  // An admin may remove someone else's board.
  assert.equal((await call({ method: 'PUT', cookie: boss, body: { board: board('c1x', { removedAt: Date.now(), updatedAt: Date.now() }) } })).status, 200);
  assert.ok(!(await getBoards(cat)).some((b) => b.id === 'c1x'));
});
await t('removing a board hides it for everyone and a stale save does not revive it', async () => {
  assert.equal((await call({ method: 'PUT', cookie: ann, body: { board: board('b1', { removedAt: Date.now(), updatedAt: Date.now() }) } })).status, 200);
  assert.ok(!(await getBoards(owner)).some((b) => b.id === 'b1'));
  await call({ method: 'PUT', cookie: owner, body: { board: board('b1') } });
  assert.ok(!(await getBoards(owner)).some((b) => b.id === 'b1'));
  // A non-creator re-sending the existing removal is not refused (stale tombstone).
  assert.equal((await call({ method: 'PUT', cookie: cat, body: { board: board('b1', { removedAt: Date.now() - 5000 }) } })).status, 200);
});
await t('admins list removed boards and restore them; others cannot', async () => {
  assert.equal((await call({ cookie: ann, query: '?removed=1' })).status, 403);
  const rm = await (await call({ cookie: boss, query: '?removed=1' })).json();
  assert.deepEqual(rm.boards.map((b) => b.id).sort(), ['b1', 'c1x']);
  assert.equal((await call({ method: 'POST', cookie: ann, body: { action: 'restore', id: 'b1' } })).status, 403);
  assert.equal((await call({ method: 'POST', cookie: boss, body: { action: 'restore', id: 'nope' } })).status, 404);
  assert.equal((await call({ method: 'POST', cookie: boss, body: { action: 'restore', id: '../x' } })).status, 400);
  const r = await call({ method: 'POST', cookie: boss, body: { action: 'restore', id: 'b1' } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).board.removedAt, undefined);
  assert.ok((await getBoards(ann)).some((b) => b.id === 'b1'));
  assert.ok(!(await (await call({ cookie: boss, query: '?removed=1' })).json()).boards.some((b) => b.id === 'b1'));
  // A browser still holding the old removal can't remove it again by re-sending it.
  const stale = board('b1', { removedAt: Date.now() - 60_000, updatedAt: Date.now() - 60_000 });
  await call({ method: 'PUT', cookie: ann, body: { board: stale } });
  assert.ok((await getBoards(ann)).some((b) => b.id === 'b1'));
  // A restore can't be smuggled in through a save.
  await call({ method: 'PUT', cookie: cat, body: { board: board('c1x', { restoredAt: Date.now() + 1e9, updatedAt: Date.now() }) } });
  assert.ok(!(await getBoards(cat)).some((b) => b.id === 'c1x'));
});
await t('pure merge keeps column order and slots in a column only the older copy has', () => {
  const a = { id: 'x', name: 'x', updatedAt: 1, columns: [{ id: 'p', cards: [] }, { id: 'q', cards: [] }, { id: 'r', cards: [] }] };
  const b = { id: 'x', name: 'x', updatedAt: 2, columns: [{ id: 'r', cards: [] }, { id: 'p', cards: [] }] };
  assert.deepEqual(B.mergeBoards(a, b).columns.map((c) => c.id), ['r', 'p', 'q']);
});

console.log('whitelist');
const XSS = '"><img src=x onerror=alert(1)>';
await t('cleanBoard: unknown fields dropped, types checked, colours whitelisted', () => {
  const out = B.cleanBoard({
    id: 'w1', name: 'W', evil: 1, openedAt: 5, shared: true, _sync: 1, createdBy: 'x@y.z', visibility: 'weird', sort: 'bogus', archived: 'yes',
    columns: [
      { id: 'c1', name: 'A', color: 'red;background:url(x)', wip: XSS, onclick: 'x', cards: [
        { id: 'k1', title: 42, desc: ['x'], labels: 'notarray', assignees: ['st_1', '<b>'], due: 'tomorrow', checklist: [{ id: 'i1', text: 'ok', done: 'true', extra: 1 }, { id: "x');alert(1)//", text: 'bad id' }],
          checklists: [{ id: 'cl1', title: 'T', items: [{ id: 'i2', text: 't' }] }], comments: [{ id: 'm1', by: 'st_1', text: 'hi', ts: 'now' }], updatedAt: 'later', html: '<script>' },
        { id: 'bad id', title: 'dropped' },
        'not a card',
      ] },
      { id: "c2'onmouseover", name: 'bad column id', cards: [] },
      { id: 'c3', name: 'B', color: 'teal', wip: '3', cards: [] },
    ],
    deleted: { k9: 5, 'b a d': 6, k8: 'x' },
  });
  assert.deepEqual(Object.keys(out).sort(), ['columns', 'deleted', 'id', 'ignoreJobs', 'name', 'type', 'updatedAt', 'v', 'visibility'].sort());
  assert.equal(out.visibility, 'everyone');
  assert.deepEqual(out.columns.map((c) => c.id), ['c1', 'c3']);
  const [c1, c3] = out.columns;
  assert.equal(c1.color, 'grey'); assert.equal(c3.color, 'teal');
  assert.equal(c1.wip, undefined, 'wip XSS payload stripped'); assert.equal(c3.wip, 3, 'numeric strings become numbers');
  assert.ok(!('onclick' in c1));
  assert.equal(c1.cards.length, 1);
  const k = c1.cards[0];
  assert.equal(k.title, ''); assert.equal(k.desc, ''); assert.deepEqual(k.labels, []); assert.deepEqual(k.assignees, ['st_1']);
  assert.equal(k.due, undefined); assert.equal(k.updatedAt, 0); assert.ok(!('html' in k));
  assert.deepEqual(k.checklist, [{ id: 'i1', text: 'ok' }]);
  assert.deepEqual(k.checklists, [{ id: 'cl1', title: 'T', items: [{ id: 'i2', text: 't' }] }]);
  assert.deepEqual(k.comments, [{ id: 'm1', by: 'st_1', text: 'hi', ts: 0 }]);
  assert.deepEqual(out.deleted, { k9: 5 });
});
await t('cleanBoard: text capped, counts limited (413), bad board refused (400)', () => {
  const big = B.cleanBoard({ id: 'w2', name: 'x', columns: [{ id: 'c', name: 'n'.repeat(5000), cards: [{ id: 'k', title: 't'.repeat(9000), desc: 'd'.repeat(50000), activity: Array.from({ length: 300 }, (_, i) => ({ ts: i, text: 'a' })) }] }] });
  assert.equal(big.columns[0].name.length, B.LIMITS.name);
  assert.equal(big.columns[0].cards[0].title.length, B.LIMITS.title);
  assert.equal(big.columns[0].cards[0].desc.length, B.LIMITS.desc);
  assert.equal(big.columns[0].cards[0].activity.length, B.LIMITS.activity);
  assert.equal(big.columns[0].cards[0].activity.at(-1).ts, 299, 'keeps the newest activity');
  const status = (fn) => { try { fn(); return 200; } catch (e) { return e.status; } };
  assert.equal(status(() => B.cleanBoard({ id: 'w3', name: 'x', columns: Array.from({ length: 101 }, (_, i) => ({ id: 'c' + i, cards: [] })) })), 413);
  assert.equal(status(() => B.cleanBoard({ id: 'w3', name: 'x', columns: [{ id: 'c', cards: [{ id: 'k', checklist: Array.from({ length: 301 }, (_, i) => ({ id: 'i' + i, text: 'x' })) }] }] })), 413);
  assert.equal(status(() => B.cleanBoard({ id: 'w3', name: 'x', columns: Array.from({ length: 2 }, (_, i) => ({ id: 'c' + i, cards: Array.from({ length: 2600 }, (_, j) => ({ id: `k${i}_${j}` })) })) })), 413);
  assert.equal(status(() => B.cleanBoard({ id: 'w3', name: 'x', columns: 'nope' })), 400);
  assert.equal(status(() => B.cleanBoard({ id: 'w3', name: 'x'.repeat(201) })), 400);
  assert.equal(status(() => B.cleanBoard([])), 400);
});
await t('the wip XSS payload never comes back from the API', async () => {
  const r = await call({ method: 'PUT', cookie: ann, body: { board: { id: 'x1', name: 'X', columns: [{ id: 'c1', name: XSS, color: 'grey" onmouseover="x', wip: XSS, cards: [{ id: 'k1', title: XSS, labels: [XSS] }] }] } } });
  assert.equal(r.status, 200);
  const got = (await getBoards(owner)).find((b) => b.id === 'x1');
  assert.equal(got.columns[0].wip, undefined);
  assert.equal(got.columns[0].color, 'grey');
  // Names and titles are kept as text (the browser escapes them); nothing executable in fields
  // that land in attributes unescaped.
  assert.equal(got.columns[0].name, XSS);
});
await t('boards stored before the whitelist are cleaned on the way out', async () => {
  blob.files.set('boards/old1.json.enc', { body: C.encryptJson({ id: 'old1', name: 'Old', evil: '<script>', columns: [{ id: 'c1', wip: XSS, color: 'x)', cards: [{ id: 'k1', onclick: 'x' }] }] }, KEY), etag: '"o1"' });
  const got = (await getBoards(ann)).find((b) => b.id === 'old1');
  assert.equal(got.evil, undefined); assert.equal(got.columns[0].wip, undefined); assert.equal(got.columns[0].color, 'grey');
  assert.equal(got.columns[0].cards[0].onclick, undefined);
});

console.log('store key');
await t('boards use STORE_KEY when set, DATA_KEY otherwise; a mismatch is a loud 500', async () => {
  const errs = []; const ce = console.error; console.error = (m) => errs.push(String(m));
  try {
    const OTHER = 'e5'.repeat(32);
    const envS = { ...env, STORE_KEY: OTHER };
    const r = await boardsHandle(req({ cookie: ann }), { env: envS, blob });
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: 'Store key mismatch' });
    // A fresh store written with STORE_KEY reads back with it, not with DATA_KEY.
    const b2 = mockBlob();
    b2.files.set('auth/access.json.enc', { body: C.encryptJson({ users, requests: [] }, Buffer.from(OTHER, 'hex')), etag: '"a"' });
    S._resetCaches();
    const w = await boardsHandle(req({ method: 'PUT', cookie: ann, body: { board: board('s1') } }), { env: envS, blob: b2 });
    assert.equal(w.status, 200);
    assert.equal(C.decryptJson(b2.files.get('boards/s1.json.enc').body, Buffer.from(OTHER, 'hex')).id, 's1');
    assert.throws(() => C.decryptJson(b2.files.get('boards/s1.json.enc').body, KEY));
  } finally { console.error = ce; S._resetCaches(); }
  assert.ok(!errs.join(' ').includes('e5e5'), 'key never logged');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
