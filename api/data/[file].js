// /api/data/<file>.json → that data file, for signed-in people only.
//
// Reads <file>.json.enc from the public streamtime-data branch (no token needed), decrypts it
// with DATA_KEY and returns the bytes STILL GZIPPED with Content-Encoding: gzip, so the browser
// inflates them. Never decompressed here: buffered function responses are capped at ~4.5 MB and
// logged_times.json is 9-18 MB raw but ~2 MB gzipped.
//
// Only names matching ^[a-z0-9_]+\.json$ (not access.json) are served, taken from the last path
// segment, so the proxy cannot be pointed anywhere else. The few files written by other things
// than the sync (platform_config.json, changelog.json, ...) stay plaintext on the branch and are
// passed through as-is when no .enc exists.

import { isAllowedDataFile, json } from '../../lib/auth.js';
import { requireUser, errorResponse } from '../../lib/guard.js';
import { fetchDataFile } from '../../lib/store.js';

export function fileFromRequest(request) {
  const { pathname } = new URL(request.url);
  const m = /^\/api\/data\/([^/]+)$/.exec(pathname);
  return m ? m[1] : null; // still percent-encoded: "%2e%2e" etc. simply fail the whitelist
}

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'private, max-age=60',
  vary: 'Cookie',
  'x-content-type-options': 'nosniff',
};

export async function handle(request, opts = {}) {
  const o = { env: opts.env || process.env, fetchImpl: opts.fetchImpl, blob: opts.blob };
  const { response } = await requireUser(request, o);
  if (response) return response;
  const file = fileFromRequest(request);
  if (!isAllowedDataFile(file)) return json({ error: 'Not found' }, 404);
  try {
    const r = await fetchDataFile(file, o);
    if (r.gz) return new Response(r.gz, { status: 200, headers: { ...HEADERS, 'content-encoding': 'gzip', 'content-length': String(r.gz.length) } });
    return new Response(r.plain.body, { status: 200, headers: HEADERS });
  } catch (e) {
    return errorResponse(e);
  }
}

export function GET(request) { return handle(request); }
