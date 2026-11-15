// Tests for the welcome-tour flag (POST /api/me), the "has joined the team" feed
// (/api/team/joins) and the weekly check-in (/api/happiness, lib/happiness.js).
// No network: Vercel Blob is mocked.  Run: node scripts/test_onboard.mjs   (made-up fixtures)

import assert from 'node:assert/strict';
import * as A from '../lib/auth.js';
import * as C from '../lib/crypt.js';
import * as S from '../lib/store.js';
import * as H from '../lib/happiness.js';
import { handle as meHandle } from '../api/me.js';
import { handle as joinsHandle, recentJoins } from '../api/team/joins.js';
import { handle as happyHandle } from '../api/happiness.js';
import { handle as accessHandle } from '../api/access.js';

const SECRET = 'x'.repeat(64);
const KEYHEX = 'c3'.repeat(32);
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
  };
  return m;
}

const NOW = Date.parse('2026-11-16T09:00:00Z'); // a Monday: ISO week 2026-W47
const days = (d) => new Date(NOW - d * 864e5).toISOString();
const blob = mockBlob();
const O = { env, blob };
const users = [
  { email: 'owner@cc.test', name: 'Owner Person', personKey: 'st_7', pw: 'scrypt$x$ownerownerowner', addedAt: days(200) },
  { email: 'ann@cc.test', name: 'Ann Lee', personKey: 'st_2', pw: 'scrypt$x$annannannannann', addedAt: days(3) },
  { email: 'boss@cc.test', name: 'Boss Admin', personKey: null, pw: 'scrypt$x$bossbossbossbo', admin: true, addedAt: days(45) },
  { email: 'maya@cc.test', name: 'Maya Brown', personKey: 'st_9', pw: 'scrypt$x$mayamayamayama', addedAt: days(10) },
  { email: 'bee@cc.test', name: 'bee@cc.test', personKey: null, pw: 'scrypt$x$beebeebeebeeb', joinedAt: days(1) },
  { email: 'old@cc.test', name: 'Old Timer', personKey: 'st_3', pw: 'scrypt$x$oldoldoldoldo', addedAt: days(31) },
  { email: 'noday@cc.test', name: 'No Date', pw: 'scrypt$x$nodaynodaynod' },
  { email: 'temp@cc.test', name: 'Temp Pass', pw: 'scrypt$x$temptemptempt', mustChangePassword: true, addedAt: days(2) },
];
const seed = () => { blob.files.set('auth/access.json.enc', { body: C.encryptJson({ users, requests: [] }, KEY), etag: '"a' + Math.random() + '"' }); S._resetCaches(); };
seed();
const fresh = () => S._resetCaches();
const stored = () => C.decryptJson(blob.files.get('auth/access.json.enc').body, KEY);

const cookieFor = async (email) => {
  const u = users.find((x) => x.email === email);
  const { cookies } = await A.newSession(u, A.adminEmailSet(env), env);
  return cookies[0].split(';')[0];
};
function req(path, { method = 'GET', cookie = '', body, origin = ORIGIN, headers = {} } = {}) {
  const h = new Headers(headers);
  if (cookie) h.set('cookie', cookie);
  if (origin && method !== 'GET') h.set('origin', origin);
  if (body !== undefined) h.set('content-type', 'application/json');
  return new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
}
const ann = await cookieFor('ann@cc.test');
const owner = await cookieFor('owner@cc.test');
const boss = await cookieFor('boss@cc.test');
const maya = await cookieFor('maya@cc.test');
const temp = await cookieFor('temp@cc.test');

// ── 1. Welcome tour flag: POST /api/me ─────────────────────────────────────────────────────
console.log('welcome tour flag (/api/me)');
const me = (o = {}) => meHandle(req('/api/me', o), O);
await t('GET leaves onboarded out until it is set', async () => {
  const j = await (await me({ cookie: ann })).json();
  assert.deepEqual(j, { email: 'ann@cc.test', name: 'Ann Lee', personKey: 'st_2', admin: false });
});
await t('POST onboarded member: saved on the caller\'s own record, returned by GET', async () => {
  const r = await me({ method: 'POST', cookie: ann, body: { action: 'onboarded', role: 'member' } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.onboarded, 'member'); assert.ok(Date.parse(j.onboardedAt));
  const doc = stored();
  const a = doc.users.find((u) => u.email === 'ann@cc.test');
  assert.equal(a.onboarded, 'member'); assert.ok(a.onboardedAt);
  assert.equal(a.pw, 'scrypt$x$annannannannann', 'nothing else on the record changes');
  assert.ok(doc.users.filter((u) => u.email !== 'ann@cc.test').every((u) => u.onboarded === undefined), 'nobody else is touched');
  assert.ok(!blob.files.get('auth/access.json.enc').body.toString('latin1').includes('ann@cc.test'), 'still encrypted');
  fresh();
  assert.equal((await (await me({ cookie: ann })).json()).onboarded, 'member');
});
await t('POST cannot target someone else (extra fields are ignored)', async () => {
  await me({ method: 'POST', cookie: ann, body: { action: 'onboarded', role: 'member', email: 'maya@cc.test' } });
  assert.equal(stored().users.find((u) => u.email === 'maya@cc.test').onboarded, undefined);
});
await t('admins can record admin; members cannot claim it; unknown role/action refused', async () => {
  assert.equal((await me({ method: 'POST', cookie: ann, body: { action: 'onboarded', role: 'admin' } })).status, 403);
  assert.equal((await me({ method: 'POST', cookie: ann, body: { action: 'onboarded', role: 'owner' } })).status, 400);
  assert.equal((await me({ method: 'POST', cookie: ann, body: { action: 'setAdmin', role: 'member' } })).status, 400);
  const r = await me({ method: 'POST', cookie: boss, body: { action: 'onboarded', role: 'admin' } });
  assert.equal(r.status, 200);
  fresh();
  assert.equal((await (await me({ cookie: boss })).json()).onboarded, 'admin');
  // a role change is just another POST
  assert.equal((await me({ method: 'POST', cookie: boss, body: { action: 'onboarded', role: 'member' } })).status, 200);
  assert.equal(stored().users.find((u) => u.email === 'boss@cc.test').onboarded, 'member');
});
await t('CSRF: foreign or missing Origin refused; signed out refused; forced password change refused', async () => {
  const puts = blob.calls.put;
  assert.equal((await me({ method: 'POST', cookie: ann, origin: 'https://evil.test', body: { action: 'onboarded', role: 'member' } })).status, 403);
  assert.equal((await me({ method: 'POST', cookie: ann, origin: '', body: { action: 'onboarded', role: 'member' } })).status, 403);
  assert.equal((await me({ method: 'POST', body: { action: 'onboarded', role: 'member' } })).status, 401);
  assert.equal((await me({ method: 'POST', cookie: temp, body: { action: 'onboarded', role: 'member' } })).status, 403);
  assert.equal((await me({ method: 'POST', cookie: ann, body: 'not json' })).status, 400, 'bad JSON');
  assert.equal((await me({ method: 'POST', cookie: ann, body: { action: 'onboarded', role: 'member', pad: 'x'.repeat(2000) } })).status, 413);
  assert.equal(blob.calls.put, puts, 'nothing written');
});
await t('a removed person\'s session cannot write', async () => {
  const gone = await cookieFor('noday@cc.test');
  const doc = stored();
  blob.files.set('auth/access.json.enc', { body: C.encryptJson({ ...doc, users: doc.users.filter((u) => u.email !== 'noday@cc.test') }, KEY), etag: '"gone"' });
  fresh();
  assert.equal((await me({ method: 'POST', cookie: gone, body: { action: 'onboarded', role: 'member' } })).status, 401);
  seed();
});

// ── 2. /api/team/joins ─────────────────────────────────────────────────────────────────────
console.log('team joins (/api/team/joins)');
const joins = (cookie) => joinsHandle(req('/api/team/joins', { cookie }), { ...O, now: NOW });
await t('auth required', async () => {
  assert.equal((await joins('')).status, 401);
  assert.equal((await joins('__Host-cc_session=forged.token')).status, 401);
  assert.equal((await joins(temp)).status, 403, 'not before the temporary password is changed');
  assert.equal((await joinsHandle(req('/api/team/joins', { method: 'POST', cookie: ann, body: {} }), O)).status, 405);
});
await t('last 30 days only, oldest first; asker\'s own join left out', async () => {
  const j = await (await joins(owner)).json();
  assert.deepEqual(j.joins.map((x) => x.name), ['Maya Brown', 'Ann Lee', 'Temp Pass', 'A new teammate']);
  const forAnn = await (await joins(ann)).json();
  assert.ok(!forAnn.joins.some((x) => x.name === 'Ann Lee'), 'never your own join');
  assert.equal(forAnn.joins.length, 3);
});
await t('names only: no emails, admin flags, hashes or dates beyond joinedAt', async () => {
  for (const c of [ann, owner, boss]) {
    const text = await (await joins(c)).text();
    assert.ok(!/@/.test(text), 'no emails (even a record whose name is its email)');
    assert.ok(!/scrypt|admin|pw|addedBy|mustChange/i.test(text));
    for (const x of JSON.parse(text).joins) assert.deepEqual(Object.keys(x).sort(), ['joinedAt', 'name', 'personKey']);
  }
});
await t('window edges: 29.9 days in, 30.1 days out, future dates out', async () => {
  const mk = (d) => ({ email: d + '@x.y', name: 'P' + d, addedAt: new Date(NOW - d * 864e5).toISOString() });
  const r = recentJoins({ users: [mk(29.9), mk(30.1), mk(-2)] }, 'me@x.y', NOW);
  assert.deepEqual(r.map((x) => x.name), ['P29.9']);
});
await t('a new account made by approve or add shows up for everyone else', async () => {
  // admin adds someone through /api/access; Ann then sees them
  const r = await accessHandle(req('/api/access', { method: 'POST', cookie: boss, body: { action: 'add', email: 'newbie@cc.test', personKey: 'st_11', name: 'New Bie', admin: false } }), O);
  assert.equal(r.status, 200);
  fresh();
  const j = await (await joinsHandle(req('/api/team/joins', { cookie: ann }), O)).json();
  assert.ok(j.joins.some((x) => x.name === 'New Bie' && x.personKey === 'st_11'));
  seed();
});

// ── 3. /api/happiness ──────────────────────────────────────────────────────────────────────
console.log('weekly check-in (/api/happiness)');
const happy = (o = {}, path = '/api/happiness') => happyHandle(req(path, o), { ...O, now: NOW });
const WK = H.isoWeekOf(NOW);
await t('ISO weeks: parse, week-of, recent list across a year boundary', async () => {
  assert.equal(WK, '2026-W47');
  assert.equal(H.isoWeekOf(Date.parse('2027-01-01T12:00:00Z')), '2026-W53');
  assert.equal(H.isoWeekOf(Date.parse('2025-12-29T12:00:00Z')), '2026-W01');
  assert.equal(H.parseWeek('2025-W53'), null, '2025 has 52 weeks');
  assert.ok(H.parseWeek('2026-W53'));
  for (const bad of ['2026-47', '2026-W00', '2026-W54', 'x', '', null, 2026]) assert.equal(H.parseWeek(bad), null, String(bad));
  const r = H.recentWeeks(3, Date.parse('2027-01-06T12:00:00Z'));
  assert.deepEqual(r, ['2026-W52', '2026-W53', '2027-W01']);
});
await t('POST saves the caller\'s own response, encrypted; the latest for a week wins', async () => {
  let r = await happy({ method: 'POST', cookie: ann, body: { week: WK, score: 2, note: 'Busy week' } });
  assert.equal(r.status, 200, await r.clone().text());
  r = await happy({ method: 'POST', cookie: ann, body: { week: WK, score: 4, note: 'Better now' } });
  assert.equal((await r.json()).response.score, 4);
  const f = blob.files.get('happiness/2026.json.enc');
  assert.ok(f, 'one blob per ISO year');
  assert.ok(!f.body.toString('latin1').includes('Better now') && !f.body.toString('latin1').includes('ann@cc.test'), 'encrypted');
  const doc = C.decryptJson(f.body, KEY);
  assert.equal(doc.responses['ann@cc.test'][WK].score, 4);
  assert.equal(Object.keys(doc.responses['ann@cc.test']).length, 1);
});
await t('POST validation: score, week window, note size, body size', async () => {
  const bad = async (body, status = 400) => assert.equal((await happy({ method: 'POST', cookie: ann, body })).status, status, JSON.stringify(body).slice(0, 80));
  await bad({ week: WK, score: 0 }); await bad({ week: WK, score: 6 }); await bad({ week: WK, score: 3.5 }); await bad({ week: WK, score: '4' });
  await bad({ week: '2026-W30', score: 3 }, 400); // too far back
  await bad({ week: '2027-W10', score: 3 }, 400); // future
  await bad({ week: '1999-W10', score: 3 }, 400);
  await bad({ week: WK, score: 3, note: 'x'.repeat(501) }, 413);
  await bad({ week: WK, score: 3, note: 42 });
  await bad({ week: WK, score: 3, note: 'x'.repeat(500), pad: 'y'.repeat(5000) }, 413);
  assert.equal((await happy({ method: 'POST', cookie: ann, body: { week: H.isoWeekOf(NOW - 14 * 864e5), score: 3, note: 'x'.repeat(500) } })).status, 200, 'a recent week and a 500-char note are fine');
});
await t('POST: CSRF, auth and forced password change', async () => {
  assert.equal((await happy({ method: 'POST', cookie: ann, origin: 'https://evil.test', body: { week: WK, score: 3 } })).status, 403);
  assert.equal((await happy({ method: 'POST', cookie: ann, origin: '', body: { week: WK, score: 3 } })).status, 403);
  assert.equal((await happy({ method: 'POST', body: { week: WK, score: 3 } })).status, 401);
  assert.equal((await happy({ method: 'POST', cookie: temp, body: { week: WK, score: 3 } })).status, 403);
});
await t('concurrent writes from two people both land (ETag retry)', async () => {
  blob.beforePut = async () => {
    // someone else saves between Maya's read and write
    await H.saveResponse({ email: 'boss@cc.test', name: 'Boss Admin', personKey: null }, { week: WK, score: 5 }, O, NOW);
  };
  const r = await happy({ method: 'POST', cookie: maya, body: { week: WK, score: 1, note: 'Rough one' } });
  assert.equal(r.status, 200);
  const doc = C.decryptJson(blob.files.get('happiness/2026.json.enc').body, KEY);
  assert.equal(doc.responses['boss@cc.test'][WK].score, 5);
  assert.equal(doc.responses['maya@cc.test'][WK].score, 1);
});
await t('GET: a member sees only their own history, never emails', async () => {
  const r = await happy({ cookie: ann }, '/api/happiness?weeks=12');
  const text = await r.text(); const j = JSON.parse(text);
  assert.equal(r.status, 200);
  assert.equal(j.admin, false); assert.equal(j.people, undefined);
  assert.equal(j.weeks.length, 12); assert.equal(j.weeks.at(-1), WK);
  assert.ok(j.responses.length === 2 && j.responses.every((x) => x.name === 'Ann Lee'));
  assert.ok(!/@/.test(text));
  assert.ok(!text.includes('Rough one'), 'nobody else\'s notes');
});
await t('GET: an admin sees the team (name, personKey, week, score, note) and the account count', async () => {
  const r = await happy({ cookie: boss }, '/api/happiness?weeks=12');
  const text = await r.text(); const j = JSON.parse(text);
  assert.equal(j.admin, true); assert.equal(j.people, users.length);
  assert.ok(!/@/.test(text), 'no emails for admins either');
  const m = j.responses.find((x) => x.name === 'Maya Brown');
  assert.equal(m.personKey, 'st_9'); assert.equal(m.week, WK); assert.equal(m.score, 1); assert.equal(m.note, 'Rough one');
  assert.equal(j.responses[0].week, WK, 'newest first');
  const owner1 = await (await happy({ cookie: owner })).json();
  assert.equal(owner1.admin, true, 'ADMIN_EMAILS owners count as admins');
});
await t('GET: weeks window clamps and filters', async () => {
  const j = await (await happy({ cookie: boss }, '/api/happiness?weeks=1')).json();
  assert.deepEqual(j.weeks, [WK]);
  assert.ok(j.responses.every((x) => x.week === WK));
  const big = await (await happy({ cookie: boss }, '/api/happiness?weeks=9999')).json();
  assert.equal(big.weeks.length, H.MAX_WEEKS);
  const junk = await (await happy({ cookie: boss }, '/api/happiness?weeks=abc')).json();
  assert.equal(junk.weeks.length, 12);
});
await t('GET: auth required; other methods refused', async () => {
  assert.equal((await happy({})).status, 401);
  assert.equal((await happy({ cookie: temp })).status, 403);
  assert.equal((await happyHandle(req('/api/happiness', { method: 'DELETE', cookie: ann }), O)).status, 405);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
