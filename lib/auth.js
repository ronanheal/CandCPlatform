// Shared auth helpers for middleware.js and the /api functions.
//
// Web APIs only (crypto.subtle, TextEncoder, btoa/atob), so the same code runs in the middleware,
// the Node functions and the local test script (scripts/test_auth.mjs). Password hashing lives in
// lib/password.js (it needs node:crypto). Nothing here logs secrets, passwords or emails.

export const SESSION_COOKIE = '__Host-cc_session';  // HttpOnly: the real credential
export const WHO_COOKIE = 'cc_who';                 // readable hint for the front end (UI only)
export const SESSION_TTL = 14 * 24 * 3600;          // 14 days

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── base64url ────────────────────────────────────────────────────────────────────────────────
export function b64urlFromBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function bytesFromB64url(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str) || str.length % 4 === 1) throw new Error('bad b64url');
  const pad = str.length % 4 === 2 ? '==' : str.length % 4 === 3 ? '=' : '';
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const b64urlJson = (obj) => b64urlFromBytes(enc.encode(JSON.stringify(obj)));
export const jsonFromB64url = (s) => JSON.parse(dec.decode(bytesFromB64url(s)));

// ── Signed tokens (HMAC-SHA256) ─────────────────────────────────────────────────────────────
// Format: base64url(JSON payload) "." base64url(HMAC-SHA256(SESSION_SECRET, first part)).
// Payloads carry `t` (type) and `exp` (unix seconds); verify() checks both.
const keyCache = new Map();
async function hmacKey(secret) {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET missing or shorter than 32 chars');
  let k = keyCache.get(secret);
  if (!k) {
    k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    keyCache.set(secret, k);
  }
  return k;
}

export async function sign(payload, secret) {
  const body = b64urlJson(payload);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body)));
  return body + '.' + b64urlFromBytes(sig);
}

// Returns the payload, or null for anything malformed, forged, expired or of the wrong type.
// crypto.subtle.verify compares the MAC in constant time.
export async function verify(token, secret, type, now = Math.floor(Date.now() / 1000)) {
  try {
    if (typeof token !== 'string' || token.length > 4096) return null;
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const sig = bytesFromB64url(parts[1]);
    if (sig.length !== 32) return null;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, enc.encode(parts[0]));
    if (!ok) return null;
    const p = jsonFromB64url(parts[0]);
    if (!p || typeof p !== 'object' || p.t !== type) return null;
    if (typeof p.exp !== 'number' || p.exp <= now) return null;
    return p;
  } catch (e) {
    return null;
  }
}

// ── Cookies ──────────────────────────────────────────────────────────────────────────────────
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    out[k] = part.slice(i + 1).trim();
  }
  return out;
}
export function cookieHeader(name, value, { maxAge, httpOnly = true } = {}) {
  let c = `${name}=${value}; Path=/; Secure; SameSite=Lax`;
  if (httpOnly) c += '; HttpOnly';
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  return c;
}
export const clearCookie = (name, httpOnly = true) => cookieHeader(name, '', { maxAge: 0, httpOnly });

// Readable hint cookie so the front end can pick "me" synchronously at load. The server never
// trusts it: every API call re-checks the signed session and the live access list.
export function whoCookie(s) {
  return cookieHeader(WHO_COOKIE, b64urlJson({ e: s.e, n: s.n, p: s.p || null, a: !!s.a }), { maxAge: Math.max(0, s.exp - Math.floor(Date.now() / 1000)), httpOnly: false });
}

export async function readSession(request, env = process.env) {
  const c = parseCookies(request.headers.get('cookie'));
  if (!c[SESSION_COOKIE]) return null;
  return verify(c[SESSION_COOKIE], env.SESSION_SECRET, 's');
}

// Short fingerprint of the stored password hash. Kept in the session so a password change or an
// admin reset signs out every other session for that person.
export const pwVersion = (hash) => String(hash || '').slice(-12);

// entry = the access.json user record. Returns {session, cookies:[session cookie, who cookie]}.
export async function newSession(entry, adminEmails, env = process.env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const e = normEmail(entry.email);
  const s = {
    t: 's', e, n: entry.name || e, p: entry.personKey || null,
    a: !!entry.admin || adminEmails.has(e), m: !!entry.mustChangePassword, v: pwVersion(entry.pw), exp,
  };
  return { session: s, cookies: [cookieHeader(SESSION_COOKIE, await sign(s, env.SESSION_SECRET), { maxAge: SESSION_TTL }), whoCookie(s)] };
}

// ── Paths ────────────────────────────────────────────────────────────────────────────────────
// Reachable without a session: a closed set of exact strings, compared against the raw (still
// percent-encoded) pathname. Odd spellings ("//", "/login.html/", "/%6Cogin.html",
// "/api/auth/login/..") are not in the set, so they need a session like everything else.
const PUBLIC_PATHS = new Set([
  '/login.html',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/request',
  '/api/auth/status',
  '/api/auth/password', // checks the session itself; must stay reachable while a change is forced
]);
export const isPublicPath = (pathname) => PUBLIC_PATHS.has(pathname);
export const isApiPath = (pathname) => pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('//');

// Data files the proxy may serve: lower-case snake-case .json at the top of the data branch.
// access.json (emails + password hashes) is never served by the proxy.
const DATA_FILE_RE = /^[a-z0-9_]+\.json$/;
const DATA_DENY = new Set(['access.json']);
export function isAllowedDataFile(name) {
  return typeof name === 'string' && name.length <= 80 && DATA_FILE_RE.test(name) && !DATA_DENY.has(name);
}

// ── Responses / request checks ───────────────────────────────────────────────────────────────
export function json(body, status = 200, cookies = []) {
  const h = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  for (const c of cookies) h.append('set-cookie', c);
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function appOrigin(request, env = process.env) {
  if (env.APP_ORIGIN) return env.APP_ORIGIN.replace(/\/+$/, '');
  const u = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') || u.host;
  const proto = request.headers.get('x-forwarded-proto') || u.protocol.replace(':', '');
  return `${proto}://${host}`;
}

// CSRF: state-changing requests must come from our own pages. Browsers send Origin on every
// cross-origin POST and on same-origin fetch() POSTs; Sec-Fetch-Site is the fallback signal.
export function sameOrigin(request, env = process.env) {
  const origin = request.headers.get('origin');
  if (origin) return origin === appOrigin(request, env);
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

export function clientIp(request) {
  return (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

// ── Access model ─────────────────────────────────────────────────────────────────────────────
export const normEmail = (e) => String(e || '').trim().toLowerCase();
export function normName(n) {
  return String(n || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
export function isValidEmail(e) {
  return typeof e === 'string' && e.length <= 254 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(e);
}
export const isValidPersonKey = (k) => k === null || (typeof k === 'string' && /^st_\d{1,12}$/.test(k));
export const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
export const isValidPassword = (p) => typeof p === 'string' && p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX;
export const MAX_PENDING = 50; // when full, the oldest request is dropped to make room

// Constant-time string comparison: both sides are hashed first, so neither the contents nor the
// lengths leak through timing.
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([a, b].map(async (v) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(v))))));
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

// First-admin bootstrap. Off unless env BOOTSTRAP_TOKEN is set (16+ characters); then a
// "Request access" from an ADMIN_EMAILS address that carries the matching token creates that
// admin account at once. Typing an email proves nothing, so the token is the proof.
export const BOOTSTRAP_MIN = 16;
export async function bootstrapTokenOk(token, env = process.env) {
  const want = String(env.BOOTSTRAP_TOKEN || '');
  if (want.length < BOOTSTRAP_MIN || typeof token !== 'string' || !token || token.length > 512) return false;
  return safeEqual(token.trim(), want);
}
// Is there an admin account yet? Once there is, the bootstrap is ignored entirely.
export const hasAdmin = (access, adminEmails) => ((access && access.users) || []).some((u) => u && (u.admin || adminEmails.has(normEmail(u.email))));

export function adminEmailSet(env = process.env) {
  return new Set(String(env.ADMIN_EMAILS || '').split(',').map(normEmail).filter(Boolean));
}

// Streamtime users that count for matching: Active ones only.
export function activeStUsers(users) {
  return (Array.isArray(users) ? users : []).filter((u) => u && u.id != null && ((u.userStatus && u.userStatus.name) || 'Active') === 'Active');
}
export const stName = (u) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.displayName || '';

// The Streamtime person behind a name/email: email first, then full name (case/space-insensitive).
export function matchStUser({ email, name }, users) {
  const list = activeStUsers(users);
  const e = normEmail(email);
  let u = e && list.find((x) => normEmail(x.email) === e);
  if (!u) {
    const n = normName(name);
    if (n) {
      const hits = list.filter((x) => normName(stName(x)) === n);
      if (hits.length === 1) u = hits[0]; // ambiguous names never match
    }
  }
  return u ? { personKey: 'st_' + u.id, name: stName(u) } : null;
}

export const findUser = (access, email) => ((access && access.users) || []).find((u) => normEmail(u.email) === normEmail(email)) || null;

// What a "Request access" submission should do.
//   exists    → already has an account (nothing is changed)
//   bootstrap → bootstrapOk (BOOTSTRAP_TOKEN matched), ADMIN_EMAILS email, and no admin account
//               exists yet: create it as admin now
//   pending   → a request for that email is already waiting (nothing is changed)
//   request   → recognised: store a pending request (the oldest is dropped if 50 are waiting)
//   unknown   → not found in Streamtime
// Without a valid token an ADMIN_EMAILS address goes through the normal request flow.
export function decideRequest({ email, name }, access, users, adminEmails, { bootstrapOk = false } = {}) {
  const e = normEmail(email);
  if (findUser(access, e)) return { status: 'exists' };
  const match = matchStUser({ email: e, name }, users);
  if (bootstrapOk && adminEmails.has(e) && !hasAdmin(access, adminEmails)) {
    return { status: 'bootstrap', personKey: match ? match.personKey : null, name: (match && match.name) || cleanName(name) || e };
  }
  if (!match) return { status: 'unknown' };
  const reqs = (access && access.requests) || [];
  if (reqs.some((r) => normEmail(r.email) === e)) return { status: 'pending' };
  return { status: 'request', ...match };
}

// Live rights of a signed-in session, from the access list. null = signed out.
export function currentRights(session, access, adminEmails) {
  const entry = findUser(access, session.e);
  if (!entry) return null;
  if (pwVersion(entry.pw) !== session.v) return null; // password changed or reset since sign-in
  return {
    admin: !!entry.admin || adminEmails.has(normEmail(entry.email)),
    personKey: entry.personKey || null,
    name: entry.name || null,
    mustChangePassword: !!entry.mustChangePassword,
  };
}

// What admins see: never the password hashes.
export function publicAccess(doc, adminEmails) {
  const strip = ({ pw, ...rest }) => rest;
  return {
    users: ((doc && doc.users) || []).map((u) => ({ ...strip(u), owner: adminEmails.has(normEmail(u.email)) })),
    // Requests: nobody has proved they own the email they typed (shown as "not verified").
    requests: ((doc && doc.requests) || []).map((r) => ({ ...strip(r), emailVerified: false })),
  };
}

// Pure mutation of the access document for /api/access POST. Password hashing happens before this
// is called (body.pw); throws Error with .status 400 on bad input.
export function applyAccessAction(doc, body, actorEmail, adminEmails, now = new Date().toISOString()) {
  const d = { users: Array.isArray(doc && doc.users) ? doc.users.slice() : [], requests: Array.isArray(doc && doc.requests) ? doc.requests.slice() : [] };
  const bad = (m) => { const e = new Error(m); e.status = 400; throw e; };
  const action = body && body.action;
  const email = normEmail(body && body.email);
  if (!isValidEmail(email)) bad('A valid email is needed');
  const idx = d.users.findIndex((u) => normEmail(u.email) === email);
  const actor = normEmail(actorEmail);
  const dropRequest = () => { d.requests = d.requests.filter((r) => normEmail(r.email) !== email); };
  const personKeyOf = (v) => {
    const k = v == null || v === '' ? null : v;
    if (!isValidPersonKey(k)) bad('Unknown person');
    return k;
  };
  if (action === 'add') {
    if (idx >= 0) bad('That email already has access');
    if (!body.pw) bad('Missing password');
    d.users.push({ email, personKey: personKeyOf(body.personKey), name: cleanName(body.name) || email, admin: !!body.admin, pw: body.pw, mustChangePassword: true, addedBy: actor, addedAt: now });
    dropRequest();
  } else if (action === 'update') {
    if (idx < 0) bad('Not on the list');
    d.users[idx] = { ...d.users[idx], personKey: personKeyOf(body.personKey), name: cleanName(body.name) || d.users[idx].name };
  } else if (action === 'resetPassword') {
    if (idx < 0) bad('Not on the list');
    if (!body.pw) bad('Missing password');
    d.users[idx] = { ...d.users[idx], pw: body.pw, mustChangePassword: true };
  } else if (action === 'remove') {
    if (idx < 0) bad('Not on the list');
    if (email === actor) bad('You cannot remove yourself');
    if (adminEmails.has(email)) bad('Owners are set by ADMIN_EMAILS on the server');
    d.users.splice(idx, 1);
  } else if (action === 'approve') {
    // Never the requester's own password (older requests may still carry one): the server makes
    // a temporary one (body.pw, hashed) that the admin sends to that email address, which is
    // what finally proves the requester owns it.
    const r = d.requests.find((x) => normEmail(x.email) === email);
    if (!r) bad('No request from that email');
    if (idx < 0) {
      if (!body.pw) bad('Missing password');
      d.users.push({ email, personKey: isValidPersonKey(r.personKey || null) ? (r.personKey || null) : null, name: cleanName(r.name) || email, admin: false, pw: body.pw, mustChangePassword: true, addedBy: actor, addedAt: now });
    }
    dropRequest();
  } else if (action === 'decline') {
    if (!d.requests.some((x) => normEmail(x.email) === email)) bad('No request from that email');
    dropRequest();
  } else if (action === 'setAdmin') {
    if (idx < 0) bad('Not on the list');
    if (!body.admin && email === actor && !adminEmails.has(email)) bad('You cannot remove your own admin rights');
    d.users[idx] = { ...d.users[idx], admin: !!body.admin };
  } else {
    bad('Unknown action');
  }
  return d;
}
