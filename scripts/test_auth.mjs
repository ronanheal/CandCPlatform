// Tests for sign-in, the middleware gate, the data proxy and the account store.
// No network: Vercel Blob and raw.githubusercontent.com are mocked.  Run: node scripts/test_auth.mjs
// Optional interop check with the Python helper: PYTHON=/path/to/python-with-cryptography.

import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as A from '../lib/auth.js';
import * as P from '../lib/password.js';
import * as C from '../lib/crypt.js';
import * as S from '../lib/store.js';
import middleware from '../middleware.js';
import { handle as authHandle } from '../api/auth/[action].js';
import { handle as accessHandle } from '../api/access.js';
import { handle as meHandle } from '../api/me.js';
import { handle as dataHandle, fileFromRequest } from '../api/data/[file].js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'x'.repeat(64);
const KEYHEX = 'a1'.repeat(32);
const KEY = Buffer.from(KEYHEX, 'hex');
const ORIGIN = 'https://cc.example.test';
const env = { SESSION_SECRET: SECRET, DATA_KEY: KEYHEX, ADMIN_EMAILS: 'owner@cc.test', DATA_BASE_URL: 'https://raw.test/data' };
process.env.SESSION_SECRET = SECRET; // the middleware reads process.env

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e).toString().split('\n').slice(0, 3).join('\n       ')); }
}

// ── mocks ──────────────────────────────────────────────────────────────────────────────────
class BlobNotFoundError extends Error {}
class BlobPreconditionFailedError extends Error {}
function mockBlob() {
  const files = new Map(); let n = 0; const calls = { put: 0 };
  return {
    files, calls, BlobNotFoundError, BlobPreconditionFailedError,
    async get(path, o) {
      assert.equal(o.access, 'private');
      const f = files.get(path); if (!f) return null;
      return { statusCode: 200, stream: new Blob([f.body]).stream(), blob: { etag: f.etag } };
    },
    async put(path, body, o) {
      calls.put++;
      assert.equal(o.access, 'private');
      const cur = files.get(path);
      if (o.ifMatch) { if (!cur || cur.etag !== o.ifMatch) throw new BlobPreconditionFailedError('Precondition failed'); }
      else if (cur && !o.allowOverwrite) throw new Error('Vercel Blob: This blob already exists');
      files.set(path, { body: Buffer.from(body), etag: '"e' + (++n) + '"' });
      return { pathname: path };
    },
  };
}
const ST_USERS = [
  { id: 114330, firstName: 'Ronan', lastName: 'Heal', email: 'ronan@cc.test', userStatus: { name: 'Active' } },
  { id: 2, firstName: 'Ann', lastName: 'Lee', email: 'ann@cc.test', userStatus: { name: 'Active' } },
  { id: 3, firstName: 'Old', lastName: 'Timer', email: 'old@cc.test', userStatus: { name: 'Hibernated' } },
  { id: 4, firstName: 'Gone', lastName: 'Person', email: 'gone@cc.test', userStatus: { name: 'Deleted' } },
  { id: 5, firstName: 'Sam', lastName: 'Twin', email: '', userStatus: { name: 'Active' } },
  { id: 6, firstName: 'Sam', lastName: 'Twin', email: '', userStatus: { name: 'Active' } },
  { id: 7, firstName: 'Owner', lastName: 'Person', email: 'owner@cc.test', userStatus: { name: 'Active' } },
];
function mockFetch(files) {
  return async (url) => {
    const name = url.replace(env.DATA_BASE_URL + '/', '');
    if (!url.startsWith(env.DATA_BASE_URL + '/') || !files.has(name)) return new Response('404: Not Found', { status: 404 });
    return new Response(files.get(name), { status: 200 });
  };
}
const encFile = (obj) => C.encrypt(gzipSync(Buffer.from(JSON.stringify(obj))), KEY);

function req(path, { method = 'GET', cookie = '', body, origin = ORIGIN, headers = {} } = {}) {
  const h = new Headers(headers);
  if (cookie) h.set('cookie', cookie);
  if (origin && method !== 'GET') h.set('origin', origin);
  if (body !== undefined) h.set('content-type', 'application/json');
  return new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const setCookies = (res) => res.headers.getSetCookie();
const cookieFrom = (res) => setCookies(res).map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');

// ── 1. signed cookies ─────────────────────────────────────────────────────────────────────
console.log('signed cookies');
await t('round trip', async () => {
  const tok = await A.sign({ t: 's', e: 'a@b.c', exp: 2e9 }, SECRET);
  assert.equal((await A.verify(tok, SECRET, 's')).e, 'a@b.c');
});
await t('tampered payload, tampered/truncated signature, wrong secret, wrong type, expired, junk', async () => {
  const tok = await A.sign({ t: 's', e: 'a@b.c', a: false, exp: 2e9 }, SECRET);
  const [p, s] = tok.split('.');
  const forged = A.b64urlJson({ t: 's', e: 'a@b.c', a: true, exp: 2e9 }) + '.' + s;
  assert.equal(await A.verify(forged, SECRET, 's'), null);
  const flip = s.slice(0, -2) + (s.at(-2) === 'A' ? 'B' : 'A') + s.at(-1);
  assert.equal(await A.verify(p + '.' + flip, SECRET, 's'), null);
  assert.equal(await A.verify(p + '.' + s.slice(0, 20), SECRET, 's'), null);
  assert.equal(await A.verify(tok, 'y'.repeat(64), 's'), null);
  assert.equal(await A.verify(tok, SECRET, 'p'), null);
  const old = await A.sign({ t: 's', e: 'a@b.c', exp: 1000 }, SECRET);
  assert.equal(await A.verify(old, SECRET, 's'), null);
  for (const j of ['', 'abc', 'a.b.c', '.', p + '.', '!!.!!', 'x'.repeat(5000)]) assert.equal(await A.verify(j, SECRET, 's'), null);
});
await t('short or missing SESSION_SECRET fails closed', async () => {
  await assert.rejects(A.sign({ t: 's', exp: 2e9 }, 'short'));
  assert.equal(await A.verify('a.b', undefined, 's'), null);
});

// ── 2. middleware gate ────────────────────────────────────────────────────────────────────
console.log('middleware');
const goodSession = (await A.newSession({ email: 'ann@cc.test', name: 'Ann', personKey: 'st_2', pw: 'scrypt$x$abcdefghijkl' }, new Set(), env)).cookies[0].split(';')[0];
const mustChange = (await A.newSession({ email: 'ann@cc.test', pw: 'zz', mustChangePassword: true }, new Set(), env)).cookies[0].split(';')[0];
const mw = (path, cookie) => middleware(new Request(ORIGIN + path, { headers: cookie ? { cookie } : {} }));
await t('public paths pass without a session', async () => {
  for (const p of ['/login.html', '/api/auth/login', '/api/auth/status', '/api/auth/request', '/api/auth/logout', '/api/auth/password']) {
    assert.equal((await mw(p)).headers.get('x-middleware-next'), '1', p);
  }
});
await t('everything else is gated, including odd spellings', async () => {
  const html = ['/', '/index.html', '/?x', '/?x=/login.html', '//', '///login.html', '/login.html/', '/LOGIN.html', '/%6Cogin.html', '/login.html%00',
    '/login.html;x', '/scripts/sync_loop.sh', '/lib/auth.js', '/docs/SETUP-AUTH.md', '/login.html/../index.html', '/%2e%2e/index.html'];
  for (const p of html) {
    const r = await mw(p);
    assert.notEqual(r.headers.get('x-middleware-next'), '1', p);
  }
  const api = ['/api/data/jobs.json', '/api/data/../x', '/api/data/%2e%2e%2faccess.json', '/api/me', '/api/access', '/api/auth/login/',
    '/api/auth/%6Cogin', '/api/auth/login/../../data/jobs.json', '/api/auth/login%2f..%2f..%2fdata%2fjobs.json', '/api', '/api/'];
  for (const p of api) {
    const r = await mw(p);
    assert.notEqual(r.headers.get('x-middleware-next'), '1', p);
  }
  const r = await mw('/api/data/jobs.json');
  assert.equal(r.status, 401);
  assert.match(r.headers.get('content-type'), /json/);
  const h = await mw('/index.html');
  assert.equal(h.status, 302);
  assert.equal(h.headers.get('location'), '/login.html');
});
await t('valid session passes; forged/expired do not', async () => {
  assert.equal((await mw('/', goodSession)).headers.get('x-middleware-next'), '1');
  assert.equal((await mw('/api/data/jobs.json', goodSession)).headers.get('x-middleware-next'), '1');
  const [name, val] = goodSession.split('=');
  const [p, s] = val.split('.');
  const pay = JSON.parse(Buffer.from(p, 'base64url').toString());
  const forged = `${name}=${A.b64urlJson({ ...pay, a: true })}.${s}`;
  assert.equal((await mw('/', forged)).status, 302);
  assert.equal((await mw('/', 'cc_who=' + A.b64urlJson({ e: 'x', a: true }))).status, 302, 'readable hint cookie is not a session');
});
await t('a session with a pending password change only reaches the public paths', async () => {
  assert.equal((await mw('/', mustChange)).status, 302);
  assert.equal((await mw('/api/data/jobs.json', mustChange)).status, 403);
  assert.equal((await mw('/api/auth/password', mustChange)).headers.get('x-middleware-next'), '1');
});

// ── 3. data file whitelist ────────────────────────────────────────────────────────────────
console.log('data whitelist');
await t('names', async () => {
  for (const ok of ['jobs.json', 'logged_times.json', 'logged_times_sweep.json', 'platform_config.json', 'sync_meta.json']) assert.ok(A.isAllowedDataFile(ok), ok);
  for (const bad of ['access.json', '../jobs.json', 'Jobs.json', 'jobs.JSON', 'jobs.json.enc', 'a/b.json', '.json', 'jobs', 'jobs.json%00', '%2e%2e%2fjobs.json',
    'jobs-1.json', 'job s.json', '', null, undefined, 'x'.repeat(90) + '.json']) assert.ok(!A.isAllowedDataFile(bad), String(bad));
  assert.equal(fileFromRequest(new Request(ORIGIN + '/api/data/%2e%2e%2fsecret.json')), '%2e%2e%2fsecret.json');
  assert.equal(fileFromRequest(new Request(ORIGIN + '/api/data/a/b.json')), null);
});

// ── 4. access model ───────────────────────────────────────────────────────────────────────
console.log('access model');
const admins = new Set(['owner@cc.test']);
await t('match by email or name; ignores inactive; ambiguous names never match', async () => {
  assert.equal(A.matchStUser({ email: 'ANN@cc.test' }, ST_USERS).personKey, 'st_2');
  assert.equal(A.matchStUser({ email: 'x@y.z', name: '  ronan   HEAL ' }, ST_USERS).personKey, 'st_114330');
  assert.equal(A.matchStUser({ email: 'old@cc.test', name: 'Old Timer' }, ST_USERS), null);
  assert.equal(A.matchStUser({ email: 'gone@cc.test' }, ST_USERS), null);
  assert.equal(A.matchStUser({ email: 'x@y.z', name: 'Sam Twin' }, ST_USERS), null);
  assert.equal(A.matchStUser({ email: 'x@y.z', name: 'Nobody' }, ST_USERS), null);
});
await t('decideRequest outcomes', async () => {
  const doc = { users: [{ email: 'ann@cc.test', pw: 'h' }], requests: [{ email: 'r@x.y' }] };
  assert.equal(A.decideRequest({ email: 'ann@cc.test', name: 'Ann Lee' }, doc, ST_USERS, admins).status, 'exists');
  assert.equal(A.decideRequest({ email: 'r@x.y', name: 'Ronan Heal' }, doc, ST_USERS, admins).status, 'pending');
  assert.equal(A.decideRequest({ email: 'new@x.y', name: 'Ronan Heal' }, doc, ST_USERS, admins).status, 'request');
  assert.equal(A.decideRequest({ email: 'new@x.y', name: 'Nobody Here' }, doc, ST_USERS, admins).status, 'unknown');
  assert.equal(A.decideRequest({ email: 'owner@cc.test', name: 'whoever' }, doc, ST_USERS, admins).status, 'bootstrap');
  assert.equal(A.decideRequest({ email: 'owner@cc.test', name: 'whoever' }, { users: [{ email: 'owner@cc.test' }] }, ST_USERS, admins).status, 'exists');
  const full = { users: [], requests: Array.from({ length: 50 }, (_, i) => ({ email: i + '@x.y' })) };
  assert.equal(A.decideRequest({ email: 'new@x.y', name: 'Ronan Heal' }, full, ST_USERS, admins).status, 'full');
});
await t('currentRights follows the list and the password version', async () => {
  const doc = { users: [{ email: 'ann@cc.test', pw: 'scrypt$1$abcdefghijkl', admin: false }] };
  const s = { e: 'ann@cc.test', v: A.pwVersion('scrypt$1$abcdefghijkl') };
  assert.deepEqual(A.currentRights(s, doc, admins).admin, false);
  assert.equal(A.currentRights({ ...s, v: 'other' }, doc, admins), null);
  assert.equal(A.currentRights({ e: 'gone@cc.test', v: s.v }, doc, admins), null);
});
await t('applyAccessAction validates and never takes a browser password', async () => {
  let d = { users: [], requests: [{ email: 'r@x.y', name: 'Ronan Heal', personKey: 'st_114330', pw: 'REQHASH' }] };
  d = A.applyAccessAction(d, { action: 'add', email: 'New@X.y', personKey: 'st_2', name: 'Ann', admin: true, pw: 'H1' }, 'owner@cc.test', admins);
  assert.equal(d.users[0].email, 'new@x.y'); assert.equal(d.users[0].mustChangePassword, true);
  assert.throws(() => A.applyAccessAction(d, { action: 'add', email: 'new@x.y', pw: 'H' }, 'o@x.y', admins), /already/);
  assert.throws(() => A.applyAccessAction(d, { action: 'add', email: 'bad', pw: 'H' }, 'o@x.y', admins), /valid email/);
  assert.throws(() => A.applyAccessAction(d, { action: 'add', email: 'z@x.y', personKey: '../x', pw: 'H' }, 'o@x.y', admins), /Unknown person/);
  d = A.applyAccessAction(d, { action: 'approve', email: 'r@x.y' }, 'owner@cc.test', admins);
  assert.equal(d.users[1].pw, 'REQHASH'); assert.equal(d.users[1].mustChangePassword, false); assert.equal(d.requests.length, 0);
  assert.throws(() => A.applyAccessAction(d, { action: 'remove', email: 'owner@cc.test' }, 'owner@cc.test', admins), /Not on the list/);
  d.users.push({ email: 'me@x.y', admin: true, pw: 'M' });
  assert.throws(() => A.applyAccessAction(d, { action: 'remove', email: 'me@x.y' }, 'me@x.y', admins), /yourself/);
  assert.throws(() => A.applyAccessAction(d, { action: 'setAdmin', email: 'me@x.y', admin: false }, 'me@x.y', admins), /own admin/);
  assert.throws(() => A.applyAccessAction(d, { action: 'nuke', email: 'me@x.y' }, 'me@x.y', admins), /Unknown action/);
  const pub = A.publicAccess(d, admins);
  assert.ok(pub.users.every((u) => !('pw' in u)));
});

// ── 5. passwords ──────────────────────────────────────────────────────────────────────────
console.log('passwords');
await t('scrypt hash format, verify, wrong password, malformed hashes', async () => {
  const h = await P.hashPassword('correct horse battery');
  assert.match(h, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(Buffer.from(h.split('$')[4], 'base64').length, 16);
  assert.ok(await P.verifyPassword('correct horse battery', h));
  assert.ok(!(await P.verifyPassword('correct horse batterz', h)));
  assert.notEqual(h, await P.hashPassword('correct horse battery'), 'salted');
  for (const bad of ['', 'scrypt$1$8$1$aa$bb', 'bcrypt$...', 'scrypt$16384$8$1$AAAA$AAAA', 'scrypt$999999999$8$1$' + 'A'.repeat(24) + '$' + 'A'.repeat(44)]) {
    assert.ok(!(await P.verifyPassword('x', bad)), bad);
  }
});
await t('temporary passwords', async () => {
  const a = P.tempPassword(), b = P.tempPassword();
  assert.equal(a.length, 14); assert.notEqual(a, b); assert.match(a, /^[A-Za-z2-9]+$/);
});

// ── 6. encryption ─────────────────────────────────────────────────────────────────────────
console.log('encryption');
await t('CCE1 layout, round trip, tamper and wrong key rejected', async () => {
  const e = C.encrypt(Buffer.from('hello'), KEY);
  assert.equal(e.subarray(0, 4).toString(), 'CCE1');
  assert.equal(e.length, 4 + 12 + 5 + 16);
  assert.equal(C.decrypt(e, KEY).toString(), 'hello');
  const bad = Buffer.from(e); bad[20] ^= 1;
  assert.throws(() => C.decrypt(bad, KEY));
  assert.throws(() => C.decrypt(e, Buffer.alloc(32, 7)));
  assert.throws(() => C.dataKey({ DATA_KEY: 'abc' }), /DATA_KEY/);
});
const PY = process.env.PYTHON;
await t(PY ? 'Python data_crypt.py <-> Node interop' : 'Python interop (skipped: set PYTHON to a python with cryptography)', async () => {
  if (!PY) return;
  const dir = mkdtempSync(join(tmpdir(), 'cce-'));
  const src = join(dir, 'x.json');
  writeFileSync(src, JSON.stringify({ a: 1, s: 'é ✓' }));
  const penv = { ...process.env, DATA_KEY: KEYHEX };
  execFileSync(PY, [join(ROOT, 'scripts/data_crypt.py'), 'encrypt', src, src + '.enc'], { env: penv });
  assert.deepEqual(JSON.parse(gunzipSync(C.decrypt(readFileSync(src + '.enc'), KEY))), { a: 1, s: 'é ✓' });
  const before = readFileSync(src + '.enc');
  execFileSync(PY, [join(ROOT, 'scripts/data_crypt.py'), 'encrypt', src, src + '.enc'], { env: penv });
  assert.ok(before.equals(readFileSync(src + '.enc')), 'unchanged data keeps its .enc');
  writeFileSync(join(dir, 'y.json.enc'), encFile({ b: 2 }));
  execFileSync(PY, [join(ROOT, 'scripts/data_crypt.py'), 'decrypt', join(dir, 'y.json.enc'), join(dir, 'y.json')], { env: penv });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'y.json'), 'utf8')), { b: 2 });
});

// ── 7. handlers end to end (mocked Blob + raw GitHub) ─────────────────────────────────────
console.log('handlers');
P._resetThrottle(); S._resetCaches();
const blob = mockBlob();
const raw = new Map([['users.json.enc', encFile(ST_USERS)], ['jobs.json.enc', encFile([{ id: 1 }])], ['platform_config.json', JSON.stringify({ people: {} })]]);
const fetchImpl = mockFetch(raw);
const O = { env, blob, fetchImpl };
const auth = (path, o = {}) => authHandle(req('/api/auth/' + path, o), O);
const access = (o = {}) => accessHandle(req('/api/access', o), O);
const fresh = () => S._resetCaches();

let ownerCookie, annCookie, annTemp;
await t('request access: unknown name/email', async () => {
  const r = await auth('request', { method: 'POST', body: { name: 'Nobody Known', email: 'x@y.z', password: 'longenough1' } });
  assert.equal((await r.json()).state, 'unknown');
  assert.equal(blob.calls.put, 0);
});
await t('bootstrap: ADMIN_EMAILS email + matching record creates an admin account', async () => {
  const r = await auth('request', { method: 'POST', body: { name: 'Owner Person', email: 'Owner@cc.test', password: 'owner-password-1' } });
  assert.equal((await r.json()).state, 'approved');
  fresh();
  const doc = await S.getAccess(O);
  assert.equal(doc.users[0].admin, true);
  assert.match(doc.users[0].pw, /^scrypt\$/);
  assert.ok(!blob.files.get('auth/access.json.enc').body.toString('latin1').includes('owner@cc.test'), 'stored encrypted');
});
await t('sign in: right password → session; wrong password and unknown email get the same answer', async () => {
  const ok = await auth('login', { method: 'POST', body: { email: 'owner@cc.test', password: 'owner-password-1' } });
  assert.equal(ok.status, 200);
  const sc = setCookies(ok);
  assert.ok(sc.some((c) => c.startsWith('__Host-cc_session=') && /HttpOnly/.test(c) && /Secure/.test(c) && /SameSite=Lax/.test(c) && /Path=\//.test(c)));
  assert.ok(sc.some((c) => c.startsWith('cc_who=') && !/HttpOnly/.test(c)));
  ownerCookie = cookieFrom(ok);
  const wrong = await auth('login', { method: 'POST', body: { email: 'owner@cc.test', password: 'nope-nope-nope' } });
  const unknown = await auth('login', { method: 'POST', body: { email: 'who@cc.test', password: 'nope-nope-nope' } });
  assert.equal(wrong.status, 401); assert.equal(unknown.status, 401);
  assert.deepEqual(await wrong.json(), await unknown.json());
});
await t('sign in: CSRF — foreign or missing Origin refused', async () => {
  assert.equal((await auth('login', { method: 'POST', origin: 'https://evil.test', body: { email: 'owner@cc.test', password: 'owner-password-1' } })).status, 403);
  assert.equal((await auth('login', { method: 'POST', origin: '', body: { email: 'owner@cc.test', password: 'owner-password-1' } })).status, 403);
  assert.equal((await auth('login', { method: 'POST', origin: '', headers: { 'sec-fetch-site': 'same-origin' }, body: { email: 'owner@cc.test', password: 'owner-password-1' } })).status, 200);
});
await t('throttle: five failures lock that email', async () => {
  for (let i = 0; i < 5; i++) await auth('login', { method: 'POST', body: { email: 'victim@cc.test', password: 'wrong-wrong-' + i } });
  const r = await auth('login', { method: 'POST', body: { email: 'victim@cc.test', password: 'whatever-123' } });
  assert.equal(r.status, 429);
});
await t('/api/access: admin GET never returns hashes; non-admin and signed-out refused', async () => {
  const r = await access({ cookie: ownerCookie });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(!JSON.stringify(j).includes('scrypt'));
  assert.equal((await access()).status, 401);
});
await t('admin adds a person: temporary password returned once, stored hashed, forced change', async () => {
  const r = await access({ method: 'POST', cookie: ownerCookie, body: { action: 'add', email: 'ann@cc.test', personKey: 'st_2', name: 'Ann Lee', admin: false, pw: 'ignored-from-browser' } });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  annTemp = j.tempPassword; assert.equal(annTemp.length, 14);
  const again = await (await access({ cookie: ownerCookie })).json();
  assert.ok(!JSON.stringify(again).includes(annTemp));
  fresh();
  const stored = (await S.getAccess(O)).users.find((u) => u.email === 'ann@cc.test');
  assert.ok(await P.verifyPassword(annTemp, stored.pw));
  assert.equal(stored.mustChangePassword, true);
  assert.equal((await access({ method: 'POST', cookie: ownerCookie, origin: 'https://evil.test', body: { action: 'remove', email: 'ann@cc.test' } })).status, 403);
});
await t('first sign-in with a temporary password must change it before anything else', async () => {
  const r = await auth('login', { method: 'POST', body: { email: 'ann@cc.test', password: annTemp } });
  assert.equal((await r.json()).mustChangePassword, true);
  const tmpCookie = cookieFrom(r);
  assert.equal((await meHandle(req('/api/me', { cookie: tmpCookie }), O)).status, 403);
  assert.equal((await dataHandle(req('/api/data/jobs.json', { cookie: tmpCookie }), O)).status, 403);
  const short = await auth('password', { method: 'POST', cookie: tmpCookie, body: { current: annTemp, next: 'short' } });
  assert.equal(short.status, 400);
  const badCur = await auth('password', { method: 'POST', cookie: tmpCookie, body: { current: 'wrong-current', next: 'ann-own-password' } });
  assert.equal(badCur.status, 400);
  const ch = await auth('password', { method: 'POST', cookie: tmpCookie, body: { current: annTemp, next: 'ann-own-password' } });
  assert.equal(ch.status, 200);
  annCookie = cookieFrom(ch);
  const me = await meHandle(req('/api/me', { cookie: annCookie }), O);
  assert.deepEqual(await me.json(), { email: 'ann@cc.test', name: 'Ann Lee', personKey: 'st_2', admin: false });
  fresh();
  assert.equal((await meHandle(req('/api/me', { cookie: tmpCookie }), O)).status, 401, 'old session dies with the old password');
});
await t('non-admin cannot use /api/access', async () => {
  assert.equal((await access({ cookie: annCookie })).status, 403);
  assert.equal((await access({ method: 'POST', cookie: annCookie, body: { action: 'setAdmin', email: 'ann@cc.test', admin: true } })).status, 403);
});
await t('request access → admin approves → requester signs in with their own password', async () => {
  P._resetThrottle();
  const r = await auth('request', { method: 'POST', body: { name: 'ronan heal', email: 'ronan.personal@x.y', password: 'ronans-password' } });
  assert.equal((await r.json()).state, 'requested');
  const dup = await auth('request', { method: 'POST', body: { name: 'Ronan Heal', email: 'ronan.personal@x.y', password: 'attacker-password' } });
  assert.equal((await dup.json()).state, 'requested');
  const ex = await auth('request', { method: 'POST', body: { name: 'Ann Lee', email: 'ann@cc.test', password: 'attacker-password' } });
  assert.equal((await ex.json()).state, 'requested', 'existing account answers like a request');
  fresh();
  const lst = await (await access({ cookie: ownerCookie })).json();
  assert.equal(lst.requests.length, 1); assert.equal(lst.requests[0].personKey, 'st_114330');
  assert.ok(!('pw' in lst.requests[0]));
  await access({ method: 'POST', cookie: ownerCookie, body: { action: 'approve', email: 'ronan.personal@x.y' } });
  assert.equal((await auth('login', { method: 'POST', body: { email: 'ronan.personal@x.y', password: 'attacker-password' } })).status, 401);
  assert.equal((await auth('login', { method: 'POST', body: { email: 'ronan.personal@x.y', password: 'ronans-password' } })).status, 200);
  assert.equal((await auth('login', { method: 'POST', body: { email: 'ann@cc.test', password: 'ann-own-password' } })).status, 200, 'request did not touch an existing password');
});
await t('request access is rate-limited per IP and capped at 50 pending', async () => {
  P._resetThrottle();
  const h = { 'x-forwarded-for': '203.0.113.9' };
  let last;
  for (let i = 0; i < 6; i++) last = await auth('request', { method: 'POST', headers: h, body: { name: 'Nobody', email: i + '@q.z', password: 'longenough1' } });
  assert.equal(last.status, 429);
  const many = { users: [], requests: Array.from({ length: 50 }, (_, i) => ({ email: i + '@x.y' })) };
  assert.equal(A.decideRequest({ email: 'n@x.y', name: 'Ann Lee' }, many, ST_USERS, admins).status, 'full');
  const big = await auth('request', { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.10' }, body: { name: 'A'.repeat(5000), email: 'a@b.c', password: 'longenough1' } });
  assert.equal(big.status, 413);
});
await t('reset password signs the person out; remove takes effect', async () => {
  const r = await access({ method: 'POST', cookie: ownerCookie, body: { action: 'resetPassword', email: 'ann@cc.test' } });
  assert.ok((await r.json()).tempPassword);
  fresh();
  assert.equal((await meHandle(req('/api/me', { cookie: annCookie }), O)).status, 401);
  await access({ method: 'POST', cookie: ownerCookie, body: { action: 'remove', email: 'ann@cc.test' } });
  fresh();
  assert.equal((await auth('login', { method: 'POST', body: { email: 'ann@cc.test', password: 'ann-own-password' } })).status, 401);
});
await t('concurrent writes: a stale ETag is retried, not lost', async () => {
  fresh();
  const realPut = blob.put; let first = true;
  blob.put = async (p, b, o) => { if (first) { first = false; const f = blob.files.get(p); blob.files.set(p, { ...f, etag: '"moved"' }); } return realPut(p, b, o); };
  await S.mutateAccess((d) => ({ ...d, users: [...d.users, { email: 'race@x.y' }] }), 'x', O);
  blob.put = realPut; fresh();
  assert.ok((await S.getAccess(O)).users.some((u) => u.email === 'race@x.y'));
});

console.log('data proxy');
await t('serves decrypted bytes still gzipped, with private caching', async () => {
  const r = await dataHandle(req('/api/data/jobs.json', { cookie: ownerCookie }), O);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-encoding'), 'gzip');
  assert.match(r.headers.get('content-type'), /application\/json/);
  assert.equal(r.headers.get('cache-control'), 'private, max-age=60');
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer()))), [{ id: 1 }]);
});
await t('plaintext fallback only for the config/meta files; access.json and odd names refused', async () => {
  const pc = await dataHandle(req('/api/data/platform_config.json', { cookie: ownerCookie }), O);
  assert.equal(pc.status, 200); assert.equal(pc.headers.get('content-encoding'), null);
  assert.deepEqual(await pc.json(), { people: {} });
  raw.set('quotes.json', '[{"leak":1}]');
  assert.equal((await dataHandle(req('/api/data/quotes.json', { cookie: ownerCookie }), O)).status, 404);
  for (const p of ['/api/data/access.json', '/api/data/%2e%2e%2fusers.json', '/api/data/USERS.json', '/api/data/users.json.enc']) {
    assert.equal((await dataHandle(req(p, { cookie: ownerCookie }), O)).status, 404, p);
  }
  assert.equal((await dataHandle(req('/api/data/jobs.json'), O)).status, 401);
});
await t('realistic logged_times.json (~15 MB raw) stays well under the 4.5 MB response cap', async () => {
  const words = ['Design', 'Copywriting', 'Client call', 'Revisions', 'Artwork', 'Layout', 'Proofing', 'Meeting', 'Brief', 'Research', 'Admin', 'Photo edit'];
  let seed = 7; const rnd = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  const rows = [];
  let size = 0;
  for (let i = 0; size < 15e6; i++) {
    const row = { id: 9000000 + i, userId: [114330, 2, 5, 6, 7, 11, 12][rnd(7)], jobId: 4000 + rnd(1800), jobItemId: 70000 + rnd(30000),
      date: `2026-${String(1 + rnd(12)).padStart(2, '0')}-${String(1 + rnd(28)).padStart(2, '0')}`, minutes: 15 * (1 + rnd(32)),
      notes: rnd(3) ? `${words[rnd(12)]} ${words[rnd(12)].toLowerCase()} for job ${4000 + rnd(1800)}` : '', billable: !!rnd(4),
      rate: [150, 165, 180, 0][rnd(4)], createdAt: new Date(1.76e12 + rnd(3e10)).toISOString(), loggedTimeStatus: { id: 2, name: 'Complete' } };
    rows.push(row); size += JSON.stringify(row).length + 1;
  }
  raw.set('logged_times.json.enc', encFile(rows));
  const r = await dataHandle(req('/api/data/logged_times.json', { cookie: ownerCookie }), O);
  const body = Buffer.from(await r.arrayBuffer());
  const rawLen = JSON.stringify(rows).length;
  console.log(`       raw ${(rawLen / 1e6).toFixed(1)} MB -> response ${(body.length / 1e6).toFixed(2)} MB`);
  assert.ok(rawLen > 14e6);
  assert.ok(body.length < 4.5e6, 'response under 4.5 MB');
  assert.equal(JSON.parse(gunzipSync(body)).length, rows.length);
});
await t('missing DATA_KEY fails closed', async () => {
  fresh();
  const r = await dataHandle(req('/api/data/jobs.json', { cookie: ownerCookie }), { ...O, env: { ...env, DATA_KEY: '' } });
  assert.equal(r.status, 503);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
