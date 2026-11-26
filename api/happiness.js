// /api/happiness — the weekly check-in (lib/happiness.js).
//   POST {week:'YYYY-Www', score:1-5, note?:string ≤500} → {ok, response} the signed-in
//        person's OWN response for that week (the latest one wins). Same-origin only (CSRF).
//   GET  ?weeks=12 → {weeks, responses:[{name, personKey, week, score, note, at}], admin, team, people?}
//        With the viewCheckinSummary permission: the whole team (plus people = accounts on the
//        list, for the response rate); everyone else gets only their own history. Never any emails.
//   POST needs the checkin permission.

import { json } from '../lib/auth.js';
import { requireUser, errorResponse, readJsonBody } from '../lib/guard.js';
import { getAccess } from '../lib/store.js';
import { saveResponse, listResponses } from '../lib/happiness.js';

export async function handle(request, opts = {}) {
  const env = opts.env || process.env;
  const o = { env, fetchImpl: opts.fetchImpl, gh: opts.gh };
  const now = opts.now || Date.now();
  if (request.method === 'GET') {
    const { user, response } = await requireUser(request, o);
    if (response) return response;
    try {
      const weeks = new URL(request.url).searchParams.get('weeks') || 12;
      const team = !!(user.perms && user.perms.viewCheckinSummary);
      const access = team ? await getAccess(o) : null;
      const out = await listResponses(user, { weeks, access }, o, now);
      return json({ ...out, admin: team, team, ...(team ? { people: access.users.length } : {}) });
    } catch (e) { return errorResponse(e); }
  }
  if (request.method === 'POST') {
    const { user, response } = await requireUser(request, { ...o, csrf: true, perm: 'checkin' });
    if (response) return response;
    try {
      const body = await readJsonBody(request, 4 * 1024);
      const saved = await saveResponse(user, body, o, now);
      return json({ ok: true, response: { week: saved.week, score: saved.score, note: saved.note || '', at: saved.at } });
    } catch (e) { return errorResponse(e); }
  }
  return json({ error: 'Method not allowed' }, 405);
}

export function GET(request) { return handle(request); }
export function POST(request) { return handle(request); }
