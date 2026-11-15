// /api/me → {email, name, personKey, admin, onboarded?} for the signed-in person, from the signed
// session plus the live access list. Also refreshes the readable cc_who hint cookie the front end
// uses to pick "me" at load.
//
// POST {action:'onboarded', role:'member'|'admin'} records that this person finished (or skipped)
// the welcome tour for that role: {onboarded, onboardedAt} on their OWN access-list record only.
// Same-origin only (CSRF), session re-checked against the live access list like every endpoint.

import { whoCookie, json, findUser, normEmail } from '../lib/auth.js';
import { requireUser, errorResponse, readJsonBody } from '../lib/guard.js';
import { getAccess, mutateAccess } from '../lib/store.js';

const ROLES = new Set(['member', 'admin']);

export async function handle(request, opts = {}) {
  const env = opts.env || process.env;
  const o = { env, fetchImpl: opts.fetchImpl, blob: opts.blob };
  if (request.method === 'POST') {
    const { user, response } = await requireUser(request, { ...o, csrf: true });
    if (response) return response;
    try {
      const body = await readJsonBody(request, 1024);
      if (!body || body.action !== 'onboarded') return json({ error: 'Unknown action' }, 400);
      if (!ROLES.has(body.role)) return json({ error: 'Unknown role' }, 400);
      if (body.role === 'admin' && !user.admin) return json({ error: 'Admins only' }, 403);
      const onboardedAt = new Date().toISOString();
      await mutateAccess((cur) => {
        const i = cur.users.findIndex((u) => normEmail(u.email) === normEmail(user.email));
        if (i < 0) { const e = new Error('Not on the list'); e.status = 401; throw e; }
        const users = cur.users.slice();
        users[i] = { ...users[i], onboarded: body.role, onboardedAt };
        return { ...cur, users };
      }, 'access: onboarded', o);
      return json({ ok: true, onboarded: body.role, onboardedAt });
    } catch (e) { return errorResponse(e); }
  }
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const { user, response } = await requireUser(request, o);
  if (response) return response;
  const h = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  h.append('set-cookie', whoCookie({ e: user.email, n: user.name, p: user.personKey, a: user.admin, exp: user.exp }));
  const out = { email: user.email, name: user.name, personKey: user.personKey, admin: user.admin };
  try {
    const entry = findUser(await getAccess(o), user.email); // just read by requireUser, so cached
    if (entry && ROLES.has(entry.onboarded)) out.onboarded = entry.onboarded;
  } catch (e) { /* the tour is optional; never fail /api/me over it */ }
  return new Response(JSON.stringify(out), { status: 200, headers: h });
}

export function GET(request) { return handle(request); }
export function POST(request) { return handle(request); }
