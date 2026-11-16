// Weekly check-in ("How's your week going?") responses, shared so admins can see the team's
// trend. One encrypted blob per ISO year, happiness/<YYYY>.json.enc, in the same private Vercel
// Blob store as the account list, encrypted with STORE_KEY (lib/crypt.js) and written with the
// same conditional-ETag pattern (lib/store.js).
//
// Stored shape: {v:1, responses:{<email>:{<YYYY-Www>:{score, note?, at, name, personKey}}}}.
// Keyed by email on the server only; nothing returned to a browser ever carries an email.
// The latest response for a week wins. "Skip this week" never reaches the server.

import { storeKey, encryptJson, decryptStoreJson } from './crypt.js';
import { blobSdk, streamToBuffer, strongEtag } from './store.js';
import { normEmail, cleanName } from './auth.js';

export const HAPPY_PREFIX = 'happiness/';
export const NOTE_MAX = 500;
export const MAX_WEEKS = 53;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;
const DAY = 864e5;

const bad = (m, status = 400) => { const e = new Error(m); e.status = status; return e; };
export const happyPath = (year) => `${HAPPY_PREFIX}${year}.json.enc`;

// Monday 00:00 UTC of ISO week 1 of `year`.
function isoWeek1(year) {
  const jan4 = Date.UTC(year, 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7; // 0 = Monday
  return jan4 - dow * DAY;
}
const weeksInYear = (year) => Math.round((isoWeek1(year + 1) - isoWeek1(year)) / (7 * DAY));

// 'YYYY-Www' → {year, week, monday (ms, UTC)} or null.
export function parseWeek(s) {
  const m = typeof s === 'string' && WEEK_RE.exec(s);
  if (!m) return null;
  const year = +m[1], week = +m[2];
  if (year < 2000 || year > 2100 || week < 1 || week > weeksInYear(year)) return null;
  return { year, week, monday: isoWeek1(year) + (week - 1) * 7 * DAY };
}

// The ISO week a moment falls in (by UTC date; callers pass their own "now").
export function isoWeekOf(ms) {
  const d = new Date(ms);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const thursday = day + (3 - ((new Date(day).getUTCDay() + 6) % 7)) * DAY;
  const year = new Date(thursday).getUTCFullYear();
  const week = 1 + Math.floor((thursday - isoWeek1(year)) / (7 * DAY));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// The latest n ISO weeks, oldest first, ending with the week of `now`.
export function recentWeeks(n, now = Date.now()) {
  const cur = parseWeek(isoWeekOf(now));
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(isoWeekOf(cur.monday + 3 * DAY - i * 7 * DAY));
  return out;
}

// A response may be for the current week, the next one (time zones ahead of UTC on a Monday
// morning) or up to 8 weeks back. Nothing else, so a client can't create blobs for any year.
export function weekAllowed(week, now = Date.now()) {
  const p = parseWeek(week);
  if (!p) return false;
  const cur = parseWeek(isoWeekOf(now)).monday;
  return p.monday <= cur + 7 * DAY && p.monday >= cur - 8 * 7 * DAY;
}

export function cleanResponse(body, now = Date.now()) {
  if (!body || typeof body !== 'object') throw bad('Expected {week, score}');
  const { week, score } = body;
  if (!weekAllowed(week, now)) throw bad('Unknown week');
  if (!Number.isInteger(score) || score < 1 || score > 5) throw bad('Score must be 1 to 5');
  let note;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string') throw bad('Note must be text');
    if (body.note.length > NOTE_MAX) throw bad(`Notes are ${NOTE_MAX} characters at most`, 413);
    note = body.note.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  }
  return { week, score, note: note || undefined };
}

const normalise = (d) => ({ v: 1, responses: d && typeof d.responses === 'object' && d.responses && !Array.isArray(d.responses) ? d.responses : {} });

async function readYear(year, opts) {
  const env = opts.env || process.env;
  const key = storeKey(env);
  const s = await blobSdk(opts);
  let res;
  try {
    res = await s.get(happyPath(year), { access: 'private', useCache: false });
  } catch (e) {
    if (s.BlobNotFoundError && e instanceof s.BlobNotFoundError) res = null;
    else throw bad('Check-in store unavailable', 503);
  }
  if (!res || res.statusCode !== 200 || !res.stream) return { data: normalise(null), etag: null };
  const buf = await streamToBuffer(res.stream);
  return { data: normalise(decryptStoreJson(buf, key, 'the check-ins')), etag: strongEtag(res.blob.etag) };
}

// Save the signed-in person's response (their own record only). Returns the stored entry.
export async function saveResponse(user, body, opts = {}, now = Date.now()) {
  const r = cleanResponse(body, now);
  const year = parseWeek(r.week).year;
  const env = opts.env || process.env;
  const key = storeKey(env);
  const s = await blobSdk(opts);
  const email = normEmail(user.email);
  const entry = { score: r.score, at: new Date(now).toISOString(), name: cleanName(user.name) || null, personKey: user.personKey || null };
  if (r.note) entry.note = r.note;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, etag } = await readYear(year, opts);
    const mine = { ...(data.responses[email] || {}) };
    mine[r.week] = entry;
    const next = { ...data, responses: { ...data.responses, [email]: mine } };
    const o = { access: 'private', contentType: 'application/octet-stream', addRandomSuffix: false, cacheControlMaxAge: 60 };
    if (etag) o.ifMatch = etag;
    try {
      await s.put(happyPath(year), encryptJson(next, key), o);
      return { week: r.week, ...entry };
    } catch (e) {
      const conflict = e && ((s.BlobPreconditionFailedError && e instanceof s.BlobPreconditionFailedError) || /already exists|precondition/i.test(String(e.message)));
      if (!conflict || attempt === 2) {
        if (e && e.status) throw e;
        throw bad('Could not save the check-in', 503);
      }
    }
  }
}

// Responses for the latest `weeks` weeks. Admins: everyone's (name/personKey from the live
// access list when the person still has an account). Everyone else: only their own.
// Never returns emails.
export async function listResponses(user, { weeks = 12, access = null } = {}, opts = {}, now = Date.now()) {
  const n = Math.max(1, Math.min(MAX_WEEKS, parseInt(weeks, 10) || 12));
  const list = recentWeeks(n, now);
  const want = new Set(list);
  const years = [...new Set(list.map((w) => parseWeek(w).year))];
  const me = normEmail(user.email);
  const byEmail = new Map(((access && access.users) || []).map((u) => [normEmail(u.email), u]));
  const out = [];
  for (const y of years) {
    const { data } = await readYear(y, opts);
    for (const [email, wks] of Object.entries(data.responses)) {
      if (!user.admin && email !== me) continue;
      const acct = byEmail.get(email);
      for (const [week, e] of Object.entries(wks || {})) {
        if (!want.has(week) || !e || !Number.isInteger(e.score)) continue;
        out.push({
          name: (acct && acct.name) || e.name || 'Former member',
          personKey: (acct ? acct.personKey : e.personKey) || null,
          week, score: e.score, note: e.note || '', at: e.at || null,
          ...(user.admin ? { current: !!acct } : {}),
        });
      }
    }
  }
  out.sort((a, b) => (a.week < b.week ? 1 : a.week > b.week ? -1 : String(b.at).localeCompare(String(a.at))));
  return { weeks: list, responses: out };
}
