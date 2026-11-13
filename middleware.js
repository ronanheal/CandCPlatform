// Vercel Routing Middleware: nothing on this site is served without a signed-in session, except
// the sign-in page and the /api/auth endpoints it uses.
//
// No matcher on purpose: it runs on every request, and the decision is made here against a
// closed set of exact public paths (lib/auth.js isPublicPath). A matcher regex with negative
// lookaheads is easy to sidestep with odd spellings; an exact allow-list is not.
//
// Fails closed: with SESSION_SECRET unset nobody gets past the sign-in page.
// The functions behind /api re-check the session and the live access list on every call.

import { isPublicPath, isApiPath, readSession } from './lib/auth.js';

export const config = { runtime: 'nodejs' };

// What @vercel/functions next() returns: carry on to the static file / function.
const next = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

const deny = (pathname, status, error) => (isApiPath(pathname)
  ? new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
  : new Response(null, { status: 302, headers: { location: '/login.html', 'cache-control': 'no-store' } }));

export default async function middleware(request) {
  let pathname;
  try {
    pathname = new URL(request.url).pathname;
  } catch (e) {
    return new Response('Bad request', { status: 400 });
  }
  if (isPublicPath(pathname)) return next();

  let session = null;
  try {
    session = await readSession(request);
  } catch (e) {
    session = null;
  }
  if (!session) return deny(pathname, 401, 'Not signed in');
  // First sign-in with a temporary password: nothing but the change-password form until it's done.
  if (session.m) return deny(pathname, 403, 'Password change required');
  return next();
}
