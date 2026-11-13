// Password hashing and sign-in throttling (Node functions only; not imported by the middleware).
//
// Hash format: scrypt$N$r$p$<salt b64>$<hash b64>, 16-byte random salt, 32-byte key.
// Comparison uses crypto.timingSafeEqual. Unknown emails are checked against a dummy hash so a
// wrong email and a wrong password take the same time and get the same answer.

import { scrypt as _scrypt, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const N = 16384, R = 8, P = 1, KEYLEN = 32;

function scrypt(pw, salt, keylen, opts) {
  return new Promise((resolve, reject) => _scrypt(pw, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scrypt(String(pw).normalize('NFC'), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = +parts[1], r = +parts[2], p = +parts[3];
  // Refuse silly parameters in the stored string (it lives in a repo).
  if (!(n >= 1024 && n <= 1048576 && (n & (n - 1)) === 0 && r >= 1 && r <= 32 && p >= 1 && p <= 16)) return false;
  const salt = Buffer.from(parts[4], 'base64');
  const want = Buffer.from(parts[5], 'base64');
  if (salt.length < 8 || want.length < 16 || want.length > 64) return false;
  const got = await scrypt(String(pw).normalize('NFC'), salt, want.length, { N: n, r, p, maxmem: 256 * 1024 * 1024 });
  return timingSafeEqual(got, want);
}

// Burn the same time as a real check when the email is unknown.
let dummy = null;
export async function dummyVerify(pw) {
  if (!dummy) dummy = await hashPassword('not-a-real-password-' + randomBytes(8).toString('hex'));
  await verifyPassword(pw, dummy);
  return false;
}

// Temporary passwords for admin adds/resets: 14 chars from an unambiguous alphabet (~80 bits).
const ALPHA = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function tempPassword(len = 14) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHA[randomInt(ALPHA.length)];
  return s;
}

// ── Throttling (best effort: per serverless instance, in memory) ─────────────────────────────
const buckets = new Map(); // key → {n, first, until}
const WINDOW_MS = 15 * 60 * 1000;

function bucket(key) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.first > WINDOW_MS) { b = { n: 0, first: now, until: 0 }; buckets.set(key, b); }
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.first > WINDOW_MS) buckets.delete(k);
  return b;
}

// Is this key locked right now? (e.g. 'login:<email>', 'ip:<ip>')
export function isLocked(key) {
  const b = buckets.get(key);
  return !!(b && b.until > Date.now());
}

// Count a failure; lock for `lockMs` once `max` failures land inside the window.
export function recordFailure(key, max = 5, lockMs = 5 * 60 * 1000) {
  const b = bucket(key);
  b.n += 1;
  if (b.n >= max) b.until = Date.now() + lockMs;
}
export const clearFailures = (key) => buckets.delete(key);

// Count an attempt against a plain rate limit; returns false once over `max` per window.
export function allow(key, max) {
  const b = bucket(key);
  b.n += 1;
  return b.n <= max;
}

export const failDelay = () => new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 300)));
export function _resetThrottle() { buckets.clear(); }
