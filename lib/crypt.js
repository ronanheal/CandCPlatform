// Data encryption shared with scripts/data_crypt.py.
//
// Layout: "CCE1" (4 bytes) + 12-byte random nonce + AES-256-GCM ciphertext + 16-byte tag.
// The plaintext is gzip(original bytes). Keys: 64 hex characters (32 bytes) each.
//   DATA_KEY  — the synced Streamtime files on the public branch (shared with GitHub Actions).
//   STORE_KEY — the private Blob store (access.json, boards). Falls back to DATA_KEY when unset,
//               so existing stores keep working until it is set (see docs/SETUP-AUTH.md: a key
//               can't be changed without re-encrypting what was written with the old one).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const MAGIC = Buffer.from('CCE1', 'ascii');

function keyFrom(hex, name) {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    const e = new Error(`${name} is not configured`);
    e.status = 503;
    throw e;
  }
  return Buffer.from(hex, 'hex');
}
export const dataKey = (env = process.env) => keyFrom(String(env.DATA_KEY || ''), 'DATA_KEY');
export function storeKey(env = process.env) {
  return env.STORE_KEY ? keyFrom(String(env.STORE_KEY), 'STORE_KEY') : keyFrom(String(env.DATA_KEY || ''), 'STORE_KEY (or DATA_KEY)');
}

// A Blob-store file that won't decrypt means STORE_KEY (or DATA_KEY) is not the key it was
// written with. Fail loudly with one clear error instead of treating the file as empty, which
// would let the next write replace the account list or a board with an empty one.
let mismatchLogged = false;
export function storeKeyMismatch(what) {
  if (!mismatchLogged) { mismatchLogged = true; console.error(`store key mismatch: could not decrypt ${what}; check STORE_KEY / DATA_KEY`); }
  const e = new Error('Store key mismatch');
  e.status = 500;
  e.expose = true;
  return e;
}
export function decryptStoreJson(blob, key, what) {
  let raw;
  try { raw = decrypt(blob, key); } catch (e) { throw storeKeyMismatch(what); }
  return JSON.parse(gunzipSync(raw).toString('utf8'));
}

export function encrypt(plain, key) {
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, nonce);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, nonce, body, c.getAuthTag()]);
}

// Returns the decrypted bytes (still gzipped, for data files). Throws on a bad magic, key or tag.
export function decrypt(blob, key) {
  const b = Buffer.from(blob);
  if (b.length < 4 + 12 + 16 || !b.subarray(0, 4).equals(MAGIC)) throw new Error('not a CCE1 file');
  const d = createDecipheriv('aes-256-gcm', key, b.subarray(4, 16));
  d.setAuthTag(b.subarray(b.length - 16));
  return Buffer.concat([d.update(b.subarray(16, b.length - 16)), d.final()]);
}

export const encryptJson = (obj, key) => encrypt(gzipSync(Buffer.from(JSON.stringify(obj))), key);
export const decryptJson = (blob, key) => JSON.parse(gunzipSync(decrypt(blob, key)).toString('utf8'));
