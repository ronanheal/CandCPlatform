// Where things live on the server side.
//
//  * Synced data: the public repo's streamtime-data branch, encrypted as <name>.json.enc
//    (scripts/data_crypt.py). Read without a token from raw.githubusercontent.com.
//  * Accounts: auth/access.json.enc on this repo's app-state branch, through the GitHub
//    contents API (lib/ghstore.js, env GITHUB_STATE_TOKEN). Same CCE1 format, encrypted with
//    STORE_KEY (falls back to DATA_KEY while STORE_KEY is unset; lib/crypt.js). This was a
//    Vercel Blob store until its free-tier operations ran out (2026-11).
//
// Every function takes {env, fetchImpl, gh} so the tests can run without the network.

import { dataKey, storeKey, decrypt, encryptJson, decryptStoreJson } from './crypt.js';
import { isAllowedDataFile } from './auth.js';
import { redactionFor, redactValue, NO_REDACT_FILES } from './perms.js';
import { gunzipSync, gzipSync } from 'node:zlib';
import { ghStore, isConflict, conflictPause, unavailable } from './ghstore.js';

export const DATA_BASE = 'https://raw.githubusercontent.com/ronanheal/CandCPlatform/streamtime-data';
// Written by other things than the sync, never encrypted: proxied as plain files when no .enc exists.
export const PLAIN_FILES = new Set(['platform_config.json', 'changelog.json', 'platform_meta.json', 'roadmap.json']);

const dataBase = (env) => (env.DATA_BASE_URL || DATA_BASE).replace(/\/+$/, '');
const notFound = () => { const e = new Error('Not found'); e.status = 404; return e; };
// GitHub rate limiting (429) → 503 + Retry-After so the browser backs off; other errors → 502.
function upstreamError(r) {
  if (r.status === 429) {
    const e = new Error('Data source is busy, try again shortly');
    e.status = 503;
    e.retryAfter = Math.min(300, Math.max(5, parseInt(r.headers && r.headers.get('retry-after'), 10) || 60));
    return e;
  }
  const e = new Error(`Upstream ${r.status}`); e.status = 502; return e;
}

// Small per-instance cache of fetched files (~60 s), so one person's full load — and everyone
// else's on the same warm instance — doesn't fan out ~17 GitHub fetches every time. The sync
// publishes every 15 minutes at most, so a minute of staleness costs nothing.
const DATA_TTL_MS = 60 * 1000;
const DATA_CACHE_MAX = 40;
const dataCache = new Map(); // file → {at, value}

// Fetch one data file. Returns {gz: Buffer} (decrypted, still gzipped) or {plain: Buffer}.
export async function fetchDataFile(file, opts = {}) {
  if (!isAllowedDataFile(file)) throw notFound();
  const env = opts.env || process.env;
  const key = dataKey(env);
  const hit = dataCache.get(file);
  if (hit && Date.now() - hit.at < DATA_TTL_MS) return hit.value;
  const value = await fetchDataFileUncached(file, env, key, opts.fetchImpl || fetch);
  dataCache.set(file, { at: Date.now(), value });
  if (dataCache.size > DATA_CACHE_MAX) dataCache.delete(dataCache.keys().next().value);
  return value;
}

// The same file with the money (and/or cost-rate) fields cut for someone without viewFinancials
// (teamCostRates). Cached per variant like the raw file, so this is one gunzip/parse/gzip per
// file per minute per instance, not per request. Returns {gz} or {plain} like fetchDataFile.
const redactCache = new Map(); // `${file}|${variant}` → {at, value}
export async function fetchDataFileFor(file, perms, opts = {}) {
  const raw = await fetchDataFile(file, opts);
  const cut = redactionFor(perms);
  if ((!cut.money && !cut.cost) || NO_REDACT_FILES.has(file)) return raw;
  const ck = `${file}|${cut.money ? 'm' : ''}${cut.cost ? 'c' : ''}`;
  const hit = redactCache.get(ck);
  if (hit && hit.raw === raw && Date.now() - hit.at < DATA_TTL_MS) return hit.value;
  let value;
  try {
    const text = raw.gz ? gunzipSync(raw.gz).toString('utf8') : raw.plain.toString('utf8');
    const out = Buffer.from(JSON.stringify(redactValue(JSON.parse(text), cut)));
    value = raw.gz ? { gz: gzipSync(out) } : { plain: out };
  } catch (e) {
    const err = new Error('Could not prepare that file'); err.status = 502; throw err; // never fall back to the uncut file
  }
  redactCache.set(ck, { at: Date.now(), raw, value });
  if (redactCache.size > DATA_CACHE_MAX) redactCache.delete(redactCache.keys().next().value);
  return value;
}

async function fetchDataFileUncached(file, env, key, fetchImpl) {
  const r = await fetchImpl(`${dataBase(env)}/${file}.enc`, { headers: { 'cache-control': 'no-cache' } });
  if (r.ok) {
    try {
      return { gz: decrypt(Buffer.from(await r.arrayBuffer()), key) };
    } catch (e) {
      const err = new Error('Could not decrypt data (DATA_KEY mismatch?)');
      err.status = 502;
      throw err;
    }
  }
  if (r.status !== 404) throw upstreamError(r);
  const p = await fetchImpl(`${dataBase(env)}/${file}`, { headers: { 'cache-control': 'no-cache' } });
  if (p.status === 404) throw notFound();
  if (!p.ok) throw upstreamError(p);
  if (PLAIN_FILES.has(file)) return { plain: Buffer.from(await p.arrayBuffer()) };
  // Transition: a sync-owned file the sync hasn't encrypted yet (first deploy, before the next
  // publish). Gzip it here so even logged_times.json fits under the function response cap. Once
  // PUBLISH_PLAINTEXT=false removes the plaintext, this path just 404s.
  return { gz: gzipSync(Buffer.from(await p.arrayBuffer())) };
}

// Streamtime users (users.json), cached 5 minutes, for matching names on "Request access".
let usersCache = null;
export async function getStUsers(opts = {}) {
  if (usersCache && Date.now() - usersCache.at < 5 * 60 * 1000) return usersCache.data;
  const { gz } = await fetchDataFile('users.json', opts);
  const data = JSON.parse(gunzipSync(gz).toString('utf8'));
  usersCache = { data: Array.isArray(data) ? data : [], at: Date.now() };
  return usersCache.data;
}

// ── access.json on the GitHub state branch (lib/ghstore.js) ───────────────────────────────
const ACCESS_PATH = 'auth/access.json.enc';
const ACCESS_TTL_MS = 30 * 1000;
let accessCache = null; // {data, at}

const normaliseAccess = (d) => ({
  users: Array.isArray(d && d.users) ? d.users : [],
  requests: Array.isArray(d && d.requests) ? d.requests : [],
});

// → {data, sha}; sha null when the file does not exist yet.
async function readAccessRaw(opts, fresh = false) {
  const env = opts.env || process.env;
  const key = storeKey(env);
  const s = ghStore(opts);
  let res;
  try {
    res = await s.get(ACCESS_PATH, { fresh });
  } catch (e) {
    throw unavailable('Account store unavailable', e);
  }
  if (!res) return { data: normaliseAccess(null), sha: null };
  return { data: normaliseAccess(decryptStoreJson(res.bytes, key, 'the account list')), sha: res.sha };
}

export async function getAccess({ fresh = false, ...opts } = {}) {
  if (!fresh && accessCache && Date.now() - accessCache.at < ACCESS_TTL_MS) return accessCache.data;
  const { data } = await readAccessRaw(opts, fresh);
  accessCache = { data, at: Date.now() };
  return data;
}

// Read-modify-write. The write is conditional on the sha we read (or on the file still not
// existing), so two admins acting at once can't silently undo each other; retried on conflict.
export async function mutateAccess(mutate, _message, opts = {}) {
  const env = opts.env || process.env;
  const key = storeKey(env);
  const s = ghStore(opts);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, sha } = await readAccessRaw(opts, true);
    const next = normaliseAccess(await mutate(data));
    const body = encryptJson(next, key);
    try {
      await s.put(ACCESS_PATH, body, { sha, message: 'state: update auth/access' });
      accessCache = { data: next, at: Date.now() };
      return next;
    } catch (e) {
      // The sha moved, or someone created the file between our read and write.
      if (!isConflict(e) || attempt === 2) {
        if (e && e.status && !isConflict(e)) throw e;
        const err = new Error('Could not save the account list'); err.status = 503;
        if (e && e.retryAfter) err.retryAfter = e.retryAfter;
        throw err;
      }
      await conflictPause(attempt);
    }
  }
}

export function _resetCaches(opts) {
  accessCache = null;
  usersCache = null;
  dataCache.clear();
  redactCache.clear();
  if (opts && opts.gh && opts.gh.invalidate) opts.gh.invalidate();
}
