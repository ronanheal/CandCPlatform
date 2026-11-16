// /api/team/joins → {joins:[{name, personKey, joinedAt}]} for accounts created in the last 30
// days, for the "X has joined the team!" celebration. Any signed-in person may ask; names only
// (never emails, admin flags or anything else from the access list). The asker's own account is
// left out. joinedAt is the record's joinedAt, else addedAt (set by add, approve and bootstrap).

import { json, normEmail } from '../../lib/auth.js';
import { requireUser, errorResponse } from '../../lib/guard.js';
import { getAccess } from '../../lib/store.js';

export const JOIN_WINDOW_MS = 30 * 24 * 3600 * 1000;

export function recentJoins(access, selfEmail, now = Date.now()) {
  const me = normEmail(selfEmail);
  const out = [];
  for (const u of (access && access.users) || []) {
    if (!u || normEmail(u.email) === me) continue;
    const at = Date.parse(u.joinedAt || u.addedAt || '');
    if (!isFinite(at) || at > now + 60_000 || now - at > JOIN_WINDOW_MS) continue;
    // A record without a name stores the email as its name: never send that.
    const name = u.name && !String(u.name).includes('@') ? String(u.name) : 'A new teammate';
    out.push({ name, personKey: u.personKey || null, joinedAt: new Date(at).toISOString() });
  }
  return out.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
}

export async function handle(request, opts = {}) {
  const env = opts.env || process.env;
  const o = { env, fetchImpl: opts.fetchImpl, gh: opts.gh };
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const { user, response } = await requireUser(request, o);
  if (response) return response;
  try {
    return json({ joins: recentJoins(await getAccess(o), user.email, opts.now || Date.now()) });
  } catch (e) { return errorResponse(e); }
}

export function GET(request) { return handle(request); }
