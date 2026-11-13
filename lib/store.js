// Where things live on the server side.
//
//  * Synced data: the public repo's streamtime-data branch, encrypted as <name>.json.enc
//    (scripts/data_crypt.py). Read without a token from raw.githubusercontent.com.
//  * Accounts: access.json in a PRIVATE Vercel Blob store, encrypted with the same DATA_KEY scheme.
//    Env BLOB_READ_WRITE_TOKEN (or OIDC) is injected when the store is connected to the project.
//
// Every function takes {env, fetchImpl, blob} so the tests can run without the network.

import { dataKey, decrypt, encryptJson, decryptJson } from './crypt.js';
import { isAllowedDataFile } from './auth.js';
import { gunzipSync, gzipSync } from 'node:zlib';

export const DATA_BASE = 'https://raw.githubusercontent.com/ronanheal/CandCPlatform/streamtime-data';
// Written by other things than the sync, never encrypted: proxied as plain files when no .enc exists.
export const PLAIN_FILES = new Set(['platform_config.json', 'changelog.json', 'platform_meta.json', 'roadmap.json']);

const dataBase = (env) => (env.DATA_BASE_URL || DATA_BASE).replace(/\/+$/, '');
const notFound = () => { const e = new Error('Not found'); e.status = 404; return e; };

// Fetch one data file. Returns {gz: Buffer} (decrypted, still gzipped) or {plain: Response}.
export async function fetchDataFile(file, { env = process.env, fetchImpl = fetch } = {}) {
  if (!isAllowedDataFile(file)) throw notFound();
  const key = dataKey(env);
  const r = await fetchImpl(`${dataBase(env)}/${file}.enc`, { headers: { 'cache-control': 'no-cache' } });
  if (r.ok) {
    try {
      return { gz: decrypt(Buffer.from(await r.arrayBuffer()), key) };
    } catch (e) {
      const err = new Error('Could not decrypt data');
      err.status = 502;
      throw err;
    }
  }
  if (r.status !== 404) { const e = new Error(`Upstream ${r.status}`); e.status = 502; throw e; }
  const p = await fetchImpl(`${dataBase(env)}/${file}`, { headers: { 'cache-control': 'no-cache' } });
  if (p.status === 404) throw notFound();
  if (!p.ok) { const e = new Error(`Upstream ${p.status}`); e.status = 502; throw e; }
  if (PLAIN_FILES.has(file)) return { plain: p };
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

// ── access.json in Vercel Blob ───────────────────────────────────────────────────────────────
const ACCESS_PATH = 'auth/access.json.enc';
const ACCESS_TTL_MS = 30 * 1000;
let accessCache = null; // {data, at}

let blobSdk = null;
async function sdk(opts) {
  if (opts.blob) return opts.blob;
  if (!blobSdk) blobSdk = await import('@vercel/blob');
  return blobSdk;
}

const normaliseAccess = (d) => ({
  users: Array.isArray(d && d.users) ? d.users : [],
  requests: Array.isArray(d && d.requests) ? d.requests : [],
});

async function streamToBuffer(stream) {
  const chunks = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

// → {data, etag}; etag null when the file does not exist yet.
async function readAccessRaw(opts) {
  const env = opts.env || process.env;
  const key = dataKey(env);
  const s = await sdk(opts);
  let res;
  try {
    res = await s.get(ACCESS_PATH, { access: 'private', useCache: false });
  } catch (e) {
    if (s.BlobNotFoundError && e instanceof s.BlobNotFoundError) res = null;
    else { const err = new Error('Account store unavailable'); err.status = 503; throw err; }
  }
  if (!res || res.statusCode !== 200 || !res.stream) return { data: normaliseAccess(null), etag: null };
  const buf = await streamToBuffer(res.stream);
  return { data: normaliseAccess(decryptJson(buf, key)), etag: res.blob.etag };
}

export async function getAccess({ fresh = false, ...opts } = {}) {
  if (!fresh && accessCache && Date.now() - accessCache.at < ACCESS_TTL_MS) return accessCache.data;
  const { data } = await readAccessRaw(opts);
  accessCache = { data, at: Date.now() };
  return data;
}

// Read-modify-write. The write is conditional on the ETag we read (or on the file still not
// existing), so two admins acting at once can't silently undo each other; one retry on conflict.
export async function mutateAccess(mutate, _message, opts = {}) {
  const env = opts.env || process.env;
  const key = dataKey(env);
  const s = await sdk(opts);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, etag } = await readAccessRaw(opts);
    const next = normaliseAccess(await mutate(data));
    const body = encryptJson(next, key);
    const o = { access: 'private', contentType: 'application/octet-stream', addRandomSuffix: false, cacheControlMaxAge: 60 };
    if (etag) o.ifMatch = etag; // implies allowOverwrite
    try {
      await s.put(ACCESS_PATH, body, o);
      accessCache = { data: next, at: Date.now() };
      return next;
    } catch (e) {
      // ETag moved, or someone created the file between our read and write.
      const conflict = e && ((s.BlobPreconditionFailedError && e instanceof s.BlobPreconditionFailedError) || /already exists|precondition/i.test(String(e.message)));
      if (!conflict || attempt === 2) {
        if (e && e.status) throw e;
        const err = new Error('Could not save the account list'); err.status = 503; throw err;
      }
    }
  }
}

export function _resetCaches() {
  accessCache = null;
  usersCache = null;
}
