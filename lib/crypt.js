// Data encryption shared with scripts/data_crypt.py.
//
// Layout: "CCE1" (4 bytes) + 12-byte random nonce + AES-256-GCM ciphertext + 16-byte tag.
// The plaintext is gzip(original bytes). Key: env DATA_KEY, 64 hex characters (32 bytes).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const MAGIC = Buffer.from('CCE1', 'ascii');

export function dataKey(env = process.env) {
  const hex = String(env.DATA_KEY || '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    const e = new Error('DATA_KEY is not configured');
    e.status = 503;
    throw e;
  }
  return Buffer.from(hex, 'hex');
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
