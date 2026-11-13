// /api/auth/login     POST {email, password}          → session cookie
// /api/auth/logout    POST                            → clears it
// /api/auth/status    GET                             → {state:'signed-in'|'signed-out', email, name, mustChangePassword}
// /api/auth/request   POST {name, email, token?}      → pending request (or, with the BOOTSTRAP_TOKEN, the first admin account)
// /api/auth/password  POST {current, next}            → change own password (needs a session)
//
// One function for all five keeps the deployment small. All POSTs check Origin (CSRF).
// Env: SESSION_SECRET, ADMIN_EMAILS, DATA_KEY, STORE_KEY, BOOTSTRAP_TOKEN (optional, first admin only),
// BLOB_READ_WRITE_TOKEN (Blob store connection).

import {
  SESSION_COOKIE, WHO_COOKIE, json, sameOrigin, clientIp, readSession, newSession, clearCookie,
  adminEmailSet, normEmail, isValidEmail, isValidPassword, cleanName, decideRequest, findUser, currentRights,
  bootstrapTokenOk, PASSWORD_MIN, PASSWORD_MAX, MAX_PENDING,
} from '../../lib/auth.js';
import { getAccess, getStUsers, mutateAccess } from '../../lib/store.js';
import { hashPassword, verifyPassword, dummyVerify, isLocked, recordFailure, clearFailures, allow, failDelay, tempPassword } from '../../lib/password.js';
import { requireUser, errorResponse, readJsonBody } from '../../lib/guard.js';

const GENERIC = 'Email or password is incorrect';
const pwRule = `Passwords need ${PASSWORD_MIN} to ${PASSWORD_MAX} characters`;

function actionOf(request) {
  const parts = new URL(request.url).pathname.split('/');
  return parts[parts.length - 1];
}

export async function handle(request, opts = {}) {
  const env = opts.env || process.env;
  const o = { env, fetchImpl: opts.fetchImpl, blob: opts.blob };
  const action = actionOf(request);
  const method = request.method;
  try {
    if (action === 'status' && method === 'GET') return await status(request, o);
    if (method !== 'POST') return json({ error: 'Not found' }, 404);
    if (!sameOrigin(request, env)) return json({ error: 'Bad origin' }, 403);
    if (action === 'login') return await login(request, o);
    if (action === 'logout') return logout();
    if (action === 'request') return await requestAccess(request, o);
    if (action === 'password') return await changePassword(request, o);
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    return errorResponse(e);
  }
}

async function login(request, o) {
  if (!o.env.SESSION_SECRET) return json({ error: 'Sign-in is not set up yet' }, 503);
  const body = await readJsonBody(request);
  const email = normEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  const ip = clientIp(request);
  if (isLocked('login:' + email) || isLocked('ip:' + ip)) {
    await failDelay();
    return json({ error: 'Too many attempts. Try again in a few minutes.' }, 429);
  }
  const bad = async () => {
    recordFailure('login:' + email, 5, 5 * 60 * 1000);
    recordFailure('ip:' + ip, 30, 10 * 60 * 1000);
    await failDelay();
    return json({ error: GENERIC }, 401);
  };
  if (!isValidEmail(email) || !password || password.length > PASSWORD_MAX) { await dummyVerify(password.slice(0, PASSWORD_MAX)); return bad(); }
  const access = await getAccess({ ...o, fresh: true });
  const entry = findUser(access, email);
  const ok = entry && entry.pw ? await verifyPassword(password, entry.pw) : await dummyVerify(password);
  if (!ok) return bad();
  clearFailures('login:' + email);
  const { cookies } = await newSession(entry, adminEmailSet(o.env), o.env);
  return json({ ok: true, mustChangePassword: !!entry.mustChangePassword }, 200, cookies);
}

function logout() {
  return json({ ok: true }, 200, [clearCookie(SESSION_COOKIE), clearCookie(WHO_COOKIE, false)]);
}

async function status(request, o) {
  let s = null;
  try { s = await readSession(request, o.env); } catch (e) { s = null; }
  if (!s) return json({ state: 'signed-out' });
  try {
    const rights = currentRights(s, await getAccess(o), adminEmailSet(o.env));
    if (!rights) return json({ state: 'signed-out' }, 200, [clearCookie(SESSION_COOKIE), clearCookie(WHO_COOKIE, false)]);
    return json({ state: 'signed-in', email: s.e, name: rights.name || s.n, mustChangePassword: rights.mustChangePassword || !!s.m });
  } catch (e) {
    return json({ state: 'signed-in', email: s.e, name: s.n, mustChangePassword: !!s.m });
  }
}

// No password is asked for or stored here: whoever typed the email hasn't proved they own it.
// An admin approves, the server makes a temporary password, and the admin sends it to that email.
async function requestAccess(request, o) {
  const ip = clientIp(request);
  if (!allow('req:' + ip, 5)) { await failDelay(); return json({ error: 'Too many requests. Try again later.' }, 429); }
  const body = await readJsonBody(request, 4 * 1024);
  const name = cleanName(body.name);
  const email = normEmail(body.email);
  if (!name || name.length < 2) return json({ error: 'Please enter your full name' }, 400);
  if (!isValidEmail(email)) return json({ error: 'Please enter a valid email' }, 400);

  const adminEmails = adminEmailSet(o.env);
  const tokenGiven = typeof body.token === 'string' && body.token.trim() !== '';
  const bootstrapOk = tokenGiven && adminEmails.has(email) && (await bootstrapTokenOk(body.token, o.env));
  if (tokenGiven && !bootstrapOk) await failDelay();
  const users = await getStUsers(o);
  let temp = null, tempHash = null;
  if (bootstrapOk) { temp = tempPassword(); tempHash = await hashPassword(temp); }
  let outcome = null;
  await mutateAccess((doc) => {
    const d = decideRequest({ email, name }, doc, users, adminEmails, { bootstrapOk });
    outcome = d.status;
    if (d.status === 'bootstrap') {
      return { ...doc, users: [...doc.users, { email, personKey: d.personKey, name: d.name, admin: true, pw: tempHash, mustChangePassword: true, addedBy: 'BOOTSTRAP_TOKEN', addedAt: new Date().toISOString() }], requests: doc.requests.filter((r) => normEmail(r.email) !== email) };
    }
    if (d.status === 'request') {
      // Full: drop the oldest waiting request rather than refusing new ones.
      return { ...doc, requests: [...doc.requests, { email, name: d.name, givenName: name, personKey: d.personKey, at: new Date().toISOString() }].slice(-MAX_PENDING) };
    }
    const e = new Error('no-write'); e.noWrite = true; throw e; // nothing to store
  }, 'access: request', o).catch((e) => { if (!e.noWrite) throw e; });

  // Shown once, to whoever holds the setup code; they must change it at first sign-in.
  if (outcome === 'bootstrap') return json({ state: 'approved', tempPassword: temp });
  if (outcome === 'request' || outcome === 'pending' || outcome === 'exists') {
    // "exists" answers like a request so the form cannot be used to probe who has an account;
    // an existing account is never touched here.
    return json({ state: 'requested' });
  }
  await failDelay();
  return json({ state: 'unknown' });
}

async function changePassword(request, o) {
  const { user, response } = await requireUser(request, { ...o, allowMustChange: true });
  if (response) return response;
  const ip = clientIp(request);
  if (isLocked('pw:' + user.email) || isLocked('ip:' + ip)) { await failDelay(); return json({ error: 'Too many attempts. Try again in a few minutes.' }, 429); }
  const body = await readJsonBody(request);
  const current = typeof body.current === 'string' ? body.current : '';
  const next = body.next;
  if (!isValidPassword(next)) return json({ error: pwRule }, 400);
  if (next === current) return json({ error: 'Choose a password different from the current one' }, 400);
  const access = await getAccess({ ...o, fresh: true });
  const entry = findUser(access, user.email);
  if (!entry || !(await verifyPassword(current, entry.pw))) {
    recordFailure('pw:' + user.email, 5, 5 * 60 * 1000);
    await failDelay();
    return json({ error: 'Current password is incorrect' }, 400);
  }
  const pw = await hashPassword(next);
  const doc = await mutateAccess((cur) => {
    const i = cur.users.findIndex((u) => normEmail(u.email) === user.email);
    if (i < 0) { const e = new Error('Not on the list'); e.status = 401; throw e; }
    const users = cur.users.slice();
    users[i] = { ...users[i], pw, mustChangePassword: false, pwChangedAt: new Date().toISOString() };
    return { ...cur, users };
  }, 'access: password change', o);
  const { cookies } = await newSession(findUser(doc, user.email), adminEmailSet(o.env), o.env);
  return json({ ok: true }, 200, cookies);
}

export function GET(request) { return handle(request); }
export function POST(request) { return handle(request); }
