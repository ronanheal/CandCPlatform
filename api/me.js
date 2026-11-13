// /api/me → {email, name, personKey, admin} for the signed-in person, from the signed session
// plus the live access list. Also refreshes the readable cc_who hint cookie the front end uses
// to pick "me" at load.

import { whoCookie } from '../lib/auth.js';
import { requireUser } from '../lib/guard.js';

export async function handle(request, opts = {}) {
  const { user, response } = await requireUser(request, opts);
  if (response) return response;
  const h = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  h.append('set-cookie', whoCookie({ e: user.email, n: user.name, p: user.personKey, a: user.admin, exp: user.exp }));
  return new Response(JSON.stringify({ email: user.email, name: user.name, personKey: user.personKey, admin: user.admin }), { status: 200, headers: h });
}

export function GET(request) { return handle(request); }
