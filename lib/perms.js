// Per-person permissions (mirrors Streamtime's permission screen). Replaces "admin or not".
//
// users[].perms in the access list = {<key>: boolean} for the keys below. Records written before
// permissions existed have no perms: they are derived on read (no migration write) —
// admin:true → everything, otherwise Essentials only (what a "member" saw before).
// ADMIN_EMAILS owners always have everything; nothing stored can reduce that.
// users[].admin is kept in step (admin = has userPermissions) for older code and tools.
//
// Web APIs only, no imports: lib/auth.js imports this.

export const PERM_GROUPS = [
  { key: 'essentials', label: 'Essentials', perms: [
    ['todo', 'To Do', 'Their own To Do and time'],
    ['viewTeamTodo', 'View team To Do', "See other people's weeks"],
    ['viewJobs', 'View jobs', 'Jobs list and job pages, read only'],
    ['checkin', 'Weekly check-in', 'Submit the weekly check-in'],
  ] },
  { key: 'plan', label: 'Plan & Manage', perms: [
    ['editTeamTodo', 'Edit team To Do', "Add, move and edit other people's tasks"],
    ['viewFinancials', 'View financials', 'Values, budgets, expenses, quotes, invoices'],
    ['editJobs', 'Edit jobs', 'Create, edit and archive jobs; status; labels'],
    ['team', 'Team & Schedule', 'Team page and Schedule'],
    ['viewCheckinSummary', 'Check-in summary', 'The team happiness report'],
  ] },
  { key: 'admin', label: 'Admin', perms: [
    ['company', 'Company settings', 'Workspace sync and company setup'],
    ['userPermissions', 'User permissions', 'Approve access requests and set permissions'],
    ['masterSettings', 'Master settings', 'Rates, labels and task types'],
    ['contacts', 'Clients & contacts', 'Clients and their contacts'],
    ['reporting', 'Reporting', 'The Reporting screen'],
  ] },
  { key: 'finances', label: 'Finances', perms: [
    ['accountSettings', 'Account settings', 'Data connections and backups'],
    ['teamCostRates', 'Team cost rates', 'See and change cost rates'],
    ['export', 'Export', 'CSV and print exports'],
  ] },
];
export const PERM_KEYS = PERM_GROUPS.flatMap((g) => g.perms.map((p) => p[0]));
export const ESSENTIALS = ['todo', 'viewTeamTodo', 'viewJobs', 'checkin'];
export const ALWAYS_ON = ['todo'];
const KEYSET = new Set(PERM_KEYS);

const norm = (e) => String(e || '').trim().toLowerCase();
const make = (on) => Object.fromEntries(PERM_KEYS.map((k) => [k, on.has(k)]));
export const allPerms = () => make(KEYSET);
export const essentialPerms = () => make(new Set(ESSENTIALS));

// The effective permissions of an access-list record. Never throws.
export function derivePerms(entry, adminEmails) {
  if (!entry) return make(new Set());
  if (adminEmails && adminEmails.has(norm(entry.email))) return allPerms();
  const p = entry.perms;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    const out = make(new Set(PERM_KEYS.filter((k) => p[k] === true)));
    for (const k of ALWAYS_ON) out[k] = true;
    return out;
  }
  return entry.admin ? allPerms() : essentialPerms();
}

export const isOwner = (entry, adminEmails) => !!(entry && adminEmails && adminEmails.has(norm(entry.email)));

// Validate a perms object from a request: only known keys, boolean values. Missing keys = off.
// Throws Error(.status 400) on anything else.
export function cleanPerms(input) {
  const bad = (m) => { const e = new Error(m); e.status = 400; throw e; };
  if (!input || typeof input !== 'object' || Array.isArray(input)) bad('Expected a permissions object');
  for (const [k, v] of Object.entries(input)) {
    if (!KEYSET.has(k)) bad('Unknown permission: ' + String(k).slice(0, 40));
    if (typeof v !== 'boolean') bad('Permission values must be true or false');
  }
  const out = make(new Set(PERM_KEYS.filter((k) => input[k] === true)));
  for (const k of ALWAYS_ON) out[k] = true;
  return out;
}

// Compact form for the readable cc_who hint cookie (UI only; the server never trusts it).
export function permMask(perms) {
  let m = 0;
  PERM_KEYS.forEach((k, i) => { if (perms && perms[k]) m |= 1 << i; });
  return m;
}

// ── Data-file gating (/api/data) ────────────────────────────────────────────────────────────
// Whole files that are money: refused without viewFinancials.
export const FINANCIAL_FILES = new Set(['invoices.json', 'quotes.json', 'expenses.json', 'rate_cards.json']);
// Files read only by Reporting: refused without reporting. None today — Reporting reads jobs,
// logged_times and users, which To Do and Jobs need too.
export const REPORTING_FILES = new Set([]);
// Small bookkeeping files with no money in them: served as they are.
export const NO_REDACT_FILES = new Set(['sync_meta.json', 'logged_times_sweep.json', 'changelog.json', 'roadmap.json', 'platform_meta.json', 'sync_progress.json']);

// Which perm (if any) a whole file needs. null = any signed-in person.
export function fileNeeds(file) {
  if (FINANCIAL_FILES.has(file)) return 'viewFinancials';
  if (REPORTING_FILES.has(file)) return 'reporting';
  return null;
}

// What has to be cut from the other files for this person: {money, cost} (true = cut it).
export function redactionFor(perms) {
  return { money: !(perms && perms.viewFinancials), cost: !(perms && perms.teamCostRates) };
}

// Money fields in the synced Streamtime records (jobs: totalLoggedTimeExTax, finalBudget, budget,
// sellRate…; logged_times: totalExTax; users: billableRate; job assignments / roles: rates) and in
// platform_config (people[].rate is a person's cost rate; item types carry rates). Only number
// or number-like values are cut, so ids, dates and names are never touched.
const MONEY_KEY = /(extax|inctax|budget|rate|amount|price|margin|sell|profit|revenue|fee|salary|wage|invoiced|paid)/i;
const COST_KEY = /cost/i;
const SKIP_KEY = /(id|ids|minutes|hours|count|status|date|datetime|at)$/i;
const NUMBERISH = /^\s*-?\$?\s*[\d,]+(\.\d+)?\s*(\/h)?\s*$/;
const isNumberish = (v) => (typeof v === 'number' && isFinite(v)) || (typeof v === 'string' && NUMBERISH.test(v));

// Returns a redacted deep copy. path = the keys above this value (for people[].rate).
export function redactValue(v, cut, path = []) {
  if (!cut || (!cut.money && !cut.cost)) return v;
  if (Array.isArray(v)) return v.map((x) => redactValue(x, cut, path));
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (x === null || isNumberish(x)) {
      if (!SKIP_KEY.test(k)) {
        const isCost = COST_KEY.test(k) || (k === 'rate' && path.includes('people'));
        if (isCost ? cut.cost : (cut.money && MONEY_KEY.test(k))) continue;
      }
      out[k] = x;
    } else {
      out[k] = redactValue(x, cut, path.length > 3 ? path : path.concat(k));
    }
  }
  return out;
}
