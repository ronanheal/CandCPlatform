// /api/health → usage of the GitHub state store, for admins (Settings → About → Service health,
// and the Dashboard banner). GET only.
//
//   {status:'ok'|'warn'|'alert', ok, warn, alert, reasons:[…],
//    store:{limit, remaining, reset, usedPct, remainingPct, …},   ← x-ratelimit-* from GitHub (per token)
//    instance:{calls, writes, since},                               ← this function instance, this hour
//    stateCommits7d, checkedAt}
//
// Thresholds (THRESHOLDS below): warn when under 25% of the hour's allowance is left or the state
// branch took more than 2,000 commits in 7 days; alert when under 10% is left or a rate-limited
// answer was seen in the last hour. The commit count is one request, cached 10 minutes.

import { json } from '../lib/auth.js';
import { requireUser } from '../lib/guard.js';
import { ghStore } from '../lib/ghstore.js';

export const THRESHOLDS = { warnRemainingPct: 25, alertRemainingPct: 10, warnCommits7d: 2000, rateLimitedWindowMs: 3_600_000 };

export function assess({ store, rateLimitedAt, stateCommits7d }, nowMs = Date.now()) {
  const reasons = [];
  let level = 0;
  const pct = store && store.remainingPct;
  if (pct !== null && pct !== undefined) {
    if (pct < THRESHOLDS.alertRemainingPct) { level = 2; reasons.push(`Only ${pct}% of this hour's storage allowance left`); }
    else if (pct < THRESHOLDS.warnRemainingPct) { level = Math.max(level, 1); reasons.push(`${pct}% of this hour's storage allowance left`); }
  }
  if (rateLimitedAt && nowMs - rateLimitedAt < THRESHOLDS.rateLimitedWindowMs) { level = 2; reasons.push('Storage refused a request for being over its limit in the last hour'); }
  if (typeof stateCommits7d === 'number' && stateCommits7d > THRESHOLDS.warnCommits7d) { level = Math.max(level, 1); reasons.push(`${stateCommits7d} state saves in the last 7 days`); }
  const status = ['ok', 'warn', 'alert'][level];
  return { status, ok: level === 0, warn: level === 1, alert: level === 2, reasons };
}

export async function handle(request, opts = {}) {
  const env = opts.env || process.env;
  const o = { env, fetchImpl: opts.fetchImpl, gh: opts.gh };
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const { response } = await requireUser(request, { ...o, admin: true });
  if (response) return response;
  const gh = ghStore(o);
  let stateCommits7d = null, commitsError = null;
  try { stateCommits7d = await gh.stateCommits(7); }
  catch (e) { commitsError = e && e.status === 503 && e.retryAfter ? 'Storage is busy' : 'Could not count state saves'; }
  const u = gh.usage();
  const store = { ...u.store, reset: u.store.reset ? new Date(u.store.reset * 1000).toISOString() : null, seenAt: u.store.seenAt ? new Date(u.store.seenAt).toISOString() : null };
  const verdict = assess({ store, rateLimitedAt: u.rateLimitedAt, stateCommits7d }, (opts.now || Date.now)());
  const out = {
    ...verdict,
    store,
    instance: u.instance,
    stateCommits7d,
    rateLimitedAt: u.rateLimitedAt ? new Date(u.rateLimitedAt).toISOString() : null,
    thresholds: THRESHOLDS,
    checkedAt: new Date().toISOString(),
  };
  if (commitsError) out.commitsError = commitsError;
  return json(out);
}

export function GET(request) { return handle(request); }
