// Tests for per-person permissions (lib/perms.js): derivation from old records, owners, setting
// permissions through /api/access, and the server gates that use them (/api/me, /api/data,
// /api/happiness, /api/boards admins-only). No network: GitHub is mocked.
// Run: node scripts/test_perms.mjs     (made-up fixtures)

import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import * as A from '../lib/auth.js';
import * as P from '../lib/perms.js';
import * as C from '../lib/crypt.js';
import * as S from '../lib/store.js';
import { handle as accessHandle } from '../api/access.js';
import { handle as meHandle } from '../api/me.js';
import { handle as dataHandle } from '../api/data/[file].js';
import { handle as happyHandle } from '../api/happiness.js';
import { handle as boardsHandle } from '../api/boards.js';
import { mockGitHub } from './mock_github.mjs';

const SECRET = 'x'.repeat(64);
const KEYHEX = 'd4'.repeat(32);
const KEY = Buffer.from(KEYHEX, 'hex');
const ORIGIN = 'https://cc.example.test';
const env = { SESSION_SECRET: SECRET, DATA_KEY: KEYHEX, ADMIN_EMAILS: 'owner@cc.test', DATA_BASE_URL: 'https://data.example.test' };
const admins = A.adminEmailSet(env);

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); }
}
const on = (...keys) => Object.fromEntries(P.PERM_KEYS.map((k) => [k, keys.includes(k)]));

// ── 1. derivation ───────────────────────────────────────────────────────────────────────────
console.log('derivation');
await t('17 permissions in four groups; todo is always on', async () => {
  assert.equal(P.PERM_KEYS.length, 17);
  assert.deepEqual(P.PERM_GROUPS.map((g) => g.label), ['Essentials', 'Plan & Manage', 'Admin', 'Finances']);
  assert.deepEqual(P.ESSENTIALS, ['todo', 'viewTeamTodo', 'viewJobs', 'checkin']);
});
await t('old records: admin → everything, member → Essentials only', async () => {
  assert.deepEqual(P.derivePerms({ email: 'a@x.y', admin: true }, admins), P.allPerms());
  assert.deepEqual(P.derivePerms({ email: 'a@x.y' }, admins), on(...P.ESSENTIALS));
  assert.deepEqual(P.derivePerms(null, admins), on());
});
await t('stored perms win over the admin flag; unknown keys ignored; todo forced on', async () => {
  const p = P.derivePerms({ email: 'a@x.y', admin: true, perms: { viewJobs: true, reporting: true, bogus: true, todo: false } }, admins);
  assert.deepEqual(p, on('todo', 'viewJobs', 'reporting'));
});
await t('owners (ADMIN_EMAILS) always have everything, whatever is stored', async () => {
  assert.deepEqual(P.derivePerms({ email: 'Owner@cc.test', perms: { todo: true } }, admins), P.allPerms());
});
await t('currentRights carries perms; admin = userPermissions', async () => {
  const doc = { users: [{ email: 'r@x.y', pw: 'h', perms: { reporting: true } }, { email: 'u@x.y', pw: 'h', perms: { userPermissions: true } }] };
  const r = A.currentRights({ e: 'r@x.y', v: A.pwVersion('h') }, doc, admins);
  assert.equal(r.perms.reporting, true); assert.equal(r.admin, false);
  assert.equal(A.currentRights({ e: 'u@x.y', v: A.pwVersion('h') }, doc, admins).admin, true);
});
await t('cleanPerms refuses unknown keys and non-booleans', async () => {
  assert.throws(() => P.cleanPerms({ nope: true }), /Unknown permission/);
  assert.throws(() => P.cleanPerms({ viewJobs: 'yes' }), /true or false/);
  assert.throws(() => P.cleanPerms(['viewJobs']), /object/);
  assert.deepEqual(P.cleanPerms({}), on('todo'));
});
await t('redaction cuts money and cost fields, keeps ids, dates, minutes and names', async () => {
  const job = { id: 7, name: 'Job', number: '1001', finalBudget: 5000, budget: '1200.00', totalLoggedMinutes: 90, totalLoggedTimeExTax: 300,
    estimatedStartDate: '2026-01-01', company: { id: 3, name: 'Acme' }, phases: [{ id: 1, items: [{ id: 2, sellRate: 150, totalPlannedMinutes: 60, name: 'Design' }] }] };
  const user = { id: 5, firstName: 'A', billableRate: 180, costRate: 90, hoursWorkedMonday: 8, rateCardId: 4 };
  const m = P.redactValue([job, user], { money: true, cost: true });
  assert.deepEqual(m[0], { id: 7, name: 'Job', number: '1001', totalLoggedMinutes: 90, estimatedStartDate: '2026-01-01', company: { id: 3, name: 'Acme' }, phases: [{ id: 1, items: [{ id: 2, totalPlannedMinutes: 60, name: 'Design' }] }] });
  assert.deepEqual(m[1], { id: 5, firstName: 'A', hoursWorkedMonday: 8, rateCardId: 4 });
  const c = P.redactValue(user, { money: false, cost: true });
  assert.deepEqual(c, { id: 5, firstName: 'A', billableRate: 180, hoursWorkedMonday: 8, rateCardId: 4 });
  const cfg = P.redactValue({ people: { st_1: { name: 'A', rate: 120, days: [1, 2] } } }, { money: false, cost: true });
  assert.deepEqual(cfg, { people: { st_1: { name: 'A', days: [1, 2] } } }, 'people[].rate is a cost rate');
});

// ── 2. access-list actions ──────────────────────────────────────────────────────────────────
console.log('access actions');
const base = () => ({ users: [
  { email: 'owner@cc.test', pw: 'h0' },
  { email: 'boss@cc.test', pw: 'h1', admin: true },
  { email: 'ann@cc.test', pw: 'h2' },
], requests: [{ email: 'new@cc.test', name: 'New' }] });
await t('setPerms stores the cleaned object and keeps admin in step', async () => {
  const d = A.applyAccessAction(base(), { action: 'setPerms', email: 'ann@cc.test', perms: { viewJobs: true, userPermissions: true } }, 'boss@cc.test', admins);
  const ann = d.users[2];
  assert.deepEqual(ann.perms, on('todo', 'viewJobs', 'userPermissions'));
  assert.equal(ann.admin, true);
  const d2 = A.applyAccessAction(d, { action: 'setPerms', email: 'ann@cc.test', perms: { reporting: true } }, 'boss@cc.test', admins);
  assert.equal(d2.users[2].admin, false);
});
await t('setPerms validates keys', async () => {
  assert.throws(() => A.applyAccessAction(base(), { action: 'setPerms', email: 'ann@cc.test', perms: { root: true } }, 'boss@cc.test', admins), /Unknown permission/);
  assert.throws(() => A.applyAccessAction(base(), { action: 'setPerms', email: 'nobody@cc.test', perms: {} }, 'boss@cc.test', admins), /Not on the list/);
});
await t('owners cannot be reduced (setPerms or setAdmin), all-on is a no-op', async () => {
  assert.throws(() => A.applyAccessAction(base(), { action: 'setPerms', email: 'owner@cc.test', perms: { todo: true } }, 'boss@cc.test', admins), /Owners/);
  assert.throws(() => A.applyAccessAction(base(), { action: 'setAdmin', email: 'owner@cc.test', admin: false }, 'boss@cc.test', admins), /Owners/);
  const d = A.applyAccessAction(base(), { action: 'setPerms', email: 'owner@cc.test', perms: P.allPerms() }, 'boss@cc.test', admins);
  assert.deepEqual(d.users[0], base().users[0]);
});
await t('nobody may remove the last userPermissions (no owners configured)', async () => {
  const none = new Set();
  const doc = { users: [{ email: 'boss@cc.test', admin: true }, { email: 'ann@cc.test' }], requests: [] };
  assert.throws(() => A.applyAccessAction(doc, { action: 'setPerms', email: 'boss@cc.test', perms: { viewJobs: true } }, 'boss@cc.test', none), /last person/);
  // With a second manager it is fine, even for yourself
  const two = A.applyAccessAction(doc, { action: 'setPerms', email: 'ann@cc.test', perms: { userPermissions: true } }, 'boss@cc.test', none);
  const after = A.applyAccessAction(two, { action: 'setPerms', email: 'boss@cc.test', perms: { viewJobs: true } }, 'boss@cc.test', none);
  assert.equal(after.users[0].admin, false);
  // Owners count as managers
  const withOwner = A.applyAccessAction(base(), { action: 'setPerms', email: 'boss@cc.test', perms: {} }, 'owner@cc.test', admins);
  assert.equal(withOwner.users[1].perms.userPermissions, false);
});
await t('add and approve store perms (Essentials, or everything for admin)', async () => {
  const d = A.applyAccessAction(base(), { action: 'approve', email: 'new@cc.test', pw: 'hx' }, 'boss@cc.test', admins);
  assert.deepEqual(d.users[3].perms, on(...P.ESSENTIALS));
  const a = A.applyAccessAction(base(), { action: 'add', email: 'x@cc.test', pw: 'hx', admin: true }, 'boss@cc.test', admins);
  assert.deepEqual(a.users[3].perms, P.allPerms());
  const c = A.applyAccessAction(base(), { action: 'add', email: 'y@cc.test', pw: 'hx', perms: { reporting: true } }, 'boss@cc.test', admins);
  assert.deepEqual(c.users[3].perms, on('todo', 'reporting')); assert.equal(c.users[3].admin, false);
});
await t('publicAccess shows effective perms and no password hashes', async () => {
  const pub = A.publicAccess(base(), admins);
  assert.deepEqual(pub.users[0].perms, P.allPerms()); assert.equal(pub.users[0].owner, true);
  assert.deepEqual(pub.users[2].perms, on(...P.ESSENTIALS)); assert.equal(pub.users[2].admin, false);
  assert.ok(!JSON.stringify(pub).includes('"pw"'));
});

// ── 3. endpoints ───────────────────────────────────────────────────────────────────────────
console.log('endpoints');
const gh = mockGitHub();
const users = [
  { email: 'owner@cc.test', name: 'Owner', pw: 'scrypt$x$ownerownerowner' },
  { email: 'boss@cc.test', name: 'Boss', pw: 'scrypt$x$bossbossbossbo', admin: true },          // old admin record
  { email: 'ann@cc.test', name: 'Ann', personKey: 'st_2', pw: 'scrypt$x$annannannannann' },     // old member record
  { email: 'fin@cc.test', name: 'Fin', pw: 'scrypt$x$finfinfinfinfi', perms: { viewJobs: true, viewFinancials: true } },
  { email: 'mgr@cc.test', name: 'Mgr', pw: 'scrypt$x$mgrmgrmgrmgrm', perms: { userPermissions: true } },
  { email: 'hap@cc.test', name: 'Hap', pw: 'scrypt$x$haphaphaphaph', perms: { viewCheckinSummary: true } },
  { email: 'old@cc.test', name: 'Old', pw: 'scrypt$x$oldoldoldoldo', admin: true, perms: { viewJobs: true } }, // perms win
];
const seed = () => { gh.files.set('auth/access.json.enc', { body: C.encryptJson({ users, requests: [] }, KEY), sha: '"a' + Math.random() + '"' }); S._resetCaches(); };
seed();
const stored = () => C.decryptJson(gh.files.get('auth/access.json.enc').body, KEY);
const encFile = (obj) => C.encrypt(gzipSync(Buffer.from(JSON.stringify(obj))), KEY);
const raw = new Map([
  ['jobs.json.enc', encFile([{ id: 1, name: 'J', finalBudget: 900, totalLoggedMinutes: 30, phases: [{ id: 2, items: [{ id: 3, sellRate: 150 }] }] }])],
  ['users.json.enc', encFile([{ id: 2, firstName: 'Ann', costRate: 80, billableRate: 160 }])],
  ['invoices.json.enc', encFile([{ id: 9, totalExTax: 1000 }])],
  ['quotes.json.enc', encFile([{ id: 8 }])],
  ['expenses.json.enc', encFile([{ id: 7 }])],
  ['rate_cards.json.enc', encFile([{ id: 6 }])],
  ['platform_config.json', JSON.stringify({ people: { st_2: { name: 'Ann', rate: 95 } } })],
]);
const fetchImpl = async (url) => {
  const name = url.replace(env.DATA_BASE_URL + '/', '');
  return raw.has(name) ? new Response(raw.get(name), { status: 200 }) : new Response('404', { status: 404 });
};
const O = { env, gh, fetchImpl };
function req(path, { method = 'GET', cookie = '', body, origin = ORIGIN } = {}) {
  const h = new Headers();
  if (cookie) h.set('cookie', cookie);
  if (origin && method !== 'GET') h.set('origin', origin);
  if (body !== undefined) h.set('content-type', 'application/json');
  return new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const cookie = async (email) => (await A.newSession(users.find((u) => u.email === email), admins, env)).cookies[0].split(';')[0];
const ck = {};
for (const u of users) ck[u.email.split('@')[0]] = await cookie(u.email);
const body = async (r) => { const b = Buffer.from(await r.arrayBuffer()); return JSON.parse(r.headers.get('content-encoding') === 'gzip' ? gunzipSync(b).toString() : b.toString()); };

await t('/api/me returns perms; the cc_who hint carries the bitmask', async () => {
  const r = await meHandle(req('/api/me', { cookie: ck.fin }), O);
  const j = await r.json();
  assert.deepEqual(j.perms, on('todo', 'viewJobs', 'viewFinancials')); assert.equal(j.permGroups, undefined);
  const who = JSON.parse(Buffer.from(r.headers.get('set-cookie').match(/cc_who=([^;]+)/)[1], 'base64url').toString());
  assert.equal(who.x, P.permMask(j.perms));
  const m = await (await meHandle(req('/api/me', { cookie: ck.mgr }), O)).json();
  assert.equal(m.admin, true); assert.equal(m.permGroups.length, 4);
  const o = await (await meHandle(req('/api/me', { cookie: ck.old }), O)).json();
  assert.equal(o.admin, false, 'stored perms win over the old admin flag');
});
await t('/api/access needs userPermissions (old admin, owner and mgr yes; others no)', async () => {
  for (const c of ['ann', 'fin', 'hap', 'old']) assert.equal((await accessHandle(req('/api/access', { cookie: ck[c] }), O)).status, 403, c);
  for (const c of ['owner', 'boss', 'mgr']) assert.equal((await accessHandle(req('/api/access', { cookie: ck[c] }), O)).status, 200, c);
  const p = await accessHandle(req('/api/access', { method: 'POST', cookie: ck.fin, body: { action: 'setPerms', email: 'fin@cc.test', perms: P.allPerms() } }), O);
  assert.equal(p.status, 403, 'cannot grant yourself more');
});
await t('setPerms through the API: one write, takes effect on the next request', async () => {
  const before = gh.calls.put;
  const r = await accessHandle(req('/api/access', { method: 'POST', cookie: ck.mgr, body: { action: 'setPerms', email: 'ann@cc.test', perms: { viewJobs: true, viewFinancials: true, reporting: true } } }), O);
  assert.equal(r.status, 200);
  assert.equal(gh.calls.put - before, 1);
  const j = await r.json();
  assert.deepEqual(j.users.find((u) => u.email === 'ann@cc.test').perms, on('todo', 'viewJobs', 'viewFinancials', 'reporting'));
  assert.deepEqual(stored().users.find((u) => u.email === 'ann@cc.test').perms, on('todo', 'viewJobs', 'viewFinancials', 'reporting'));
  const me = await (await meHandle(req('/api/me', { cookie: ck.ann }), O)).json();
  assert.equal(me.perms.reporting, true, 'the same session sees the change (rights come from the list, not the cookie)');
  assert.equal((await dataHandle(req('/api/data/invoices.json', { cookie: ck.ann }), O)).status, 200);
  seed();
});
await t('setPerms through the API: bad keys 400, owner 400', async () => {
  assert.equal((await accessHandle(req('/api/access', { method: 'POST', cookie: ck.mgr, body: { action: 'setPerms', email: 'ann@cc.test', perms: { sudo: true } } }), O)).status, 400);
  assert.equal((await accessHandle(req('/api/access', { method: 'POST', cookie: ck.mgr, body: { action: 'setPerms', email: 'owner@cc.test', perms: { todo: true } } }), O)).status, 400);
  seed();
});
await t('a session loses access as soon as userPermissions is taken away', async () => {
  const r = await accessHandle(req('/api/access', { method: 'POST', cookie: ck.owner, body: { action: 'setPerms', email: 'mgr@cc.test', perms: { viewJobs: true } } }), O);
  assert.equal(r.status, 200);
  assert.equal((await accessHandle(req('/api/access', { cookie: ck.mgr }), O)).status, 403);
  seed();
});

await t('data: financial files need viewFinancials', async () => {
  for (const f of ['invoices', 'quotes', 'expenses', 'rate_cards']) {
    const r = await dataHandle(req(`/api/data/${f}.json`, { cookie: ck.ann }), O);
    assert.equal(r.status, 403, f); assert.equal((await r.json()).perm, 'viewFinancials');
    assert.equal((await dataHandle(req(`/api/data/${f}.json`, { cookie: ck.fin }), O)).status, 200, f);
  }
});
await t('data: jobs/users/config have money cut without viewFinancials, cost rates without teamCostRates', async () => {
  const j = await body(await dataHandle(req('/api/data/jobs.json', { cookie: ck.ann }), O));
  assert.deepEqual(j, [{ id: 1, name: 'J', totalLoggedMinutes: 30, phases: [{ id: 2, items: [{ id: 3 }] }] }]);
  const u = await body(await dataHandle(req('/api/data/users.json', { cookie: ck.ann }), O));
  assert.deepEqual(u, [{ id: 2, firstName: 'Ann' }]);
  const uf = await body(await dataHandle(req('/api/data/users.json', { cookie: ck.fin }), O));
  assert.deepEqual(uf, [{ id: 2, firstName: 'Ann', billableRate: 160 }], 'financials but no cost rates');
  const uo = await body(await dataHandle(req('/api/data/users.json', { cookie: ck.owner }), O));
  assert.deepEqual(uo, [{ id: 2, firstName: 'Ann', costRate: 80, billableRate: 160 }]);
  const pc = await dataHandle(req('/api/data/platform_config.json', { cookie: ck.ann }), O);
  assert.equal(pc.headers.get('content-encoding'), null);
  assert.deepEqual(await body(pc), { people: { st_2: { name: 'Ann' } } });
  const jo = await body(await dataHandle(req('/api/data/jobs.json', { cookie: ck.boss }), O));
  assert.equal(jo[0].finalBudget, 900, 'old admin record sees everything');
});

const NOW = Date.parse('2026-11-16T09:00:00Z');
const happy = (o, path = '/api/happiness') => happyHandle(req(path, o), { ...O, now: NOW });
await t('happiness: submitting needs checkin', async () => {
  assert.equal((await happy({ method: 'POST', cookie: ck.ann, body: { week: '2026-W47', score: 4 } })).status, 200, 'Essentials include checkin');
  const r = await happy({ method: 'POST', cookie: ck.hap, body: { week: '2026-W47', score: 2, note: 'meh' } });
  assert.equal(r.status, 403); assert.equal((await r.json()).perm, 'checkin');
});
await t('happiness: the team summary needs viewCheckinSummary', async () => {
  assert.equal((await happy({ method: 'POST', cookie: ck.boss, body: { week: '2026-W47', score: 5 } })).status, 200);
  const a = await (await happy({ cookie: ck.ann })).json();
  assert.equal(a.team, false); assert.equal(a.people, undefined);
  assert.ok(a.responses.every((x) => x.name === 'Ann'), 'own history only');
  const h = await (await happy({ cookie: ck.hap })).json();
  assert.equal(h.team, true); assert.equal(h.admin, true); assert.equal(h.people, users.length);
  assert.deepEqual(h.responses.map((x) => x.name).sort(), ['Ann', 'Boss']);
  const m = await (await happy({ cookie: ck.mgr })).json();
  assert.equal(m.team, false, 'userPermissions alone is not the check-in summary');
});

const T0 = Date.now() - 60_000;
const board = (id, x = {}) => ({ id, v: 2, type: 'custom', name: 'Board ' + id, createdAt: T0, updatedAt: T0, shared: true, columns: [{ id: 'c1', name: 'One', cards: [] }], ...x });
const boards = (o) => boardsHandle(req('/api/boards', o), O);
await t('boards: admins-only means userPermissions', async () => {
  assert.equal((await boards({ method: 'PUT', cookie: ck.mgr, body: { board: board('hr', { visibility: 'admins' }) } })).status, 200);
  const ids = async (c) => (await (await boards({ cookie: ck[c] })).json()).boards.map((b) => b.id);
  assert.ok((await ids('mgr')).includes('hr'));
  assert.ok((await ids('boss')).includes('hr'), 'old admin record');
  assert.ok((await ids('owner')).includes('hr'));
  for (const c of ['ann', 'fin', 'hap', 'old']) assert.ok(!(await ids(c)).includes('hr'), c);
  assert.equal((await boards({ method: 'PUT', cookie: ck.fin, body: { board: board('fin', { visibility: 'admins' }) } })).status, 403);
  assert.equal((await boardsHandle(req('/api/boards?removed=1', { cookie: ck.fin }), O)).status, 403);
  assert.equal((await boardsHandle(req('/api/boards?removed=1', { cookie: ck.mgr }), O)).status, 200);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
