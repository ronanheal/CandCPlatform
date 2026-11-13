// Per-request authorisation for the /api functions. The middleware already rejects requests
// without a valid session cookie; this repeats that (defence in depth) and adds the live
// access-list check, so removing someone, resetting their password or taking admin away bites
// within the access cache window (~30s), not when the 14-day cookie runs out.

import { readSession, currentRights, adminEmailSet, json, sameOrigin, clearCookie, SESSION_COOKIE, WHO_COOKIE } from './auth.js';
import { getAccess } from './store.js';

const signedOut = (msg) => json({ error: msg }, 401, [clearCookie(SESSION_COOKIE), clearCookie(WHO_COOKIE, false)]);

// Returns {user, session} or {response}. user = {email, name, personKey, admin, exp}.
// allowMustChange: let a session whose password change is pending through (the change itself).
export async function requireUser(request, { admin = false, csrf = false, allowMustChange = false, env = process.env, fetchImpl, blob } = {}) {
  if (csrf && !sameOrigin(request, env)) return { response: json({ error: 'Bad origin' }, 403) };
  const s = await readSession(request, env);
  if (!s) return { response: json({ error: 'Not signed in' }, 401) };
  let rights;
  try {
    rights = currentRights(s, await getAccess({ env, fetchImpl, blob }), adminEmailSet(env));
  } catch (e) {
    return { response: json({ error: e.status === 503 ? 'Data store is not configured' : 'Access list unavailable' }, e.status === 503 ? 503 : 502) };
  }
  if (!rights) return { response: signedOut('Please sign in again') };
  if ((rights.mustChangePassword || s.m) && !allowMustChange) return { response: json({ error: 'Password change required' }, 403) };
  const user = { email: s.e, name: rights.name || s.n || s.e, personKey: rights.personKey || null, admin: rights.admin, exp: s.exp };
  if (admin && !user.admin) return { response: json({ error: 'Admins only' }, 403) };
  return { user, session: s };
}

export function errorResponse(e) {
  const status = e && e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
  if (status === 500) console.error(`api error: ${e && e.message ? String(e.message).slice(0, 120) : 'error'}`);
  return json({ error: status === 500 ? 'Server error' : String((e && e.message) || 'Error') }, status);
}

// Read a JSON body with a size cap.
export async function readJsonBody(request, max = 16 * 1024) {
  const ct = request.headers.get('content-type') || '';
  if (!ct.includes('application/json')) { const e = new Error('Expected JSON'); e.status = 415; throw e; }
  const text = await request.text();
  if (text.length > max) { const e = new Error('Body too large'); e.status = 413; throw e; }
  try { return JSON.parse(text); } catch (err) { const e = new Error('Bad JSON'); e.status = 400; throw e; }
}
