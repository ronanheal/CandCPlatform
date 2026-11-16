#!/usr/bin/env node
// One-off: copy the old Vercel Blob state (auth/, boards/, happiness/) to the GitHub state branch,
// byte for byte, and write boards/index.json. Needs no decryption keys: the files stay encrypted
// with the same STORE_KEY and decrypt as before.
//
//   BLOB_READ_WRITE_TOKEN=... GITHUB_STATE_TOKEN=... node scripts/migrate_blob_to_github.mjs --dry-run
//   BLOB_READ_WRITE_TOKEN=... GITHUB_STATE_TOKEN=... node scripts/migrate_blob_to_github.mjs
//
// Options:
//   --dry-run     list what would be copied; writes nothing (still reads from Blob and GitHub)
//   --overwrite   replace files that already exist on GitHub with different bytes. Without it
//                 they are skipped and reported (e.g. an account list made after the outage with
//                 the BOOTSTRAP_TOKEN, which a blind copy would throw away).
// Env: STATE_REPO (default ronanheal/CandCPlatform), STATE_BRANCH (default app-state).
//
// Blob cost: one list call (plus one per extra 1,000 files) and one read per file. Run it once
// the Blob store is readable again. Tokens are never printed.

import { pathToFileURL } from 'node:url';
import { createGhStore } from '../lib/ghstore.js';
import { BOARD_INDEX, indexBytes } from '../lib/boards.js';

let PREFIXES = ['auth/', 'boards/', 'happiness/'];
const BOARD_RE = /^boards\/([A-Za-z0-9_-]{1,64})\.json\.enc$/;

async function readAll(stream) {
  const chunks = [];
  const reader = stream.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(Buffer.from(value)); }
  return Buffer.concat(chunks);
}

// blob: the @vercel/blob module (or a stand-in with list/get); gh: a lib/ghstore.js store.
export async function migrate({ blob, token, gh, dry = false, overwrite = false, log = console.log }) {
  // One list over the whole store (fewer Blob operations than one per prefix).
  const paths = [];
  let cursor;
  do {
    const page = await blob.list({ token, cursor, limit: 1000 });
    for (const b of page.blobs || []) if (PREFIXES.some((p) => b.pathname.startsWith(p))) paths.push(b.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  paths.sort();
  log(`${paths.length} file(s) in Blob under ${PREFIXES.join(', ')}${dry ? '  (dry run: nothing is written)' : ''}`);

  const done = { copied: 0, same: 0, skipped: 0, failed: 0 };
  const boardIds = [];
  for (const path of paths) {
    const m = BOARD_RE.exec(path);
    if (path.startsWith('boards/') && !m) { log(`  skip  ${path} (not a board file)`); continue; }
    try {
      const res = await blob.get(path, { access: 'private', token, useCache: false });
      if (!res || res.statusCode !== 200 || !res.stream) { log(`  skip  ${path} (not readable)`); done.skipped++; continue; }
      const bytes = await readAll(res.stream);
      if (m) boardIds.push(m[1]);
      const cur = await gh.get(path, { fresh: true });
      if (cur && cur.bytes.equals(bytes)) { log(`  same  ${path}`); done.same++; continue; }
      if (cur && !overwrite) { log(`  SKIP  ${path} exists on GitHub with different bytes (use --overwrite to replace)`); done.skipped++; continue; }
      log(`  ${dry ? 'would copy' : 'copy'}  ${path}  ${bytes.length} bytes${cur ? ' (replaces)' : ''}`);
      if (!dry) await gh.put(path, bytes, { sha: cur ? cur.sha : null, message: `state: migrate ${path.replace(/\.json\.enc$/, '')} from Blob` });
      done.copied++;
    } catch (e) {
      log(`  FAIL  ${path}: ${e && e.message}`);
      done.failed++;
    }
  }

  // boards/index.json: what is already there plus every board file from Blob.
  if (!PREFIXES.includes('boards/')) { log(`\n${dry ? 'would copy' : 'copied'} ${done.copied}, unchanged ${done.same}, skipped ${done.skipped}, failed ${done.failed}`); return done; }
  try {
    const cur = await gh.get(BOARD_INDEX, { fresh: true });
    let have = [];
    if (cur) { try { have = JSON.parse(cur.bytes.toString('utf8')).ids || []; } catch (e) { have = []; } }
    const ids = [...new Set([...have, ...boardIds])];
    const bytes = indexBytes(ids);
    if (cur && cur.bytes.equals(bytes)) log(`index ${BOARD_INDEX}: already lists all ${ids.length} board(s)`);
    else {
      log(`index ${BOARD_INDEX}: ${dry ? 'would write' : 'write'} ${ids.length} board id(s)`);
      if (!dry) await gh.put(BOARD_INDEX, bytes, { sha: cur ? cur.sha : null, message: 'state: migrate boards/index' });
    }
  } catch (e) {
    log(`  FAIL  ${BOARD_INDEX}: ${e && e.message}`);
    done.failed++;
  }
  log(`\n${dry ? 'would copy' : 'copied'} ${done.copied}, unchanged ${done.same}, skipped ${done.skipped}, failed ${done.failed}`);
  return done;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = new Set(process.argv.slice(2));
  // --only=auth/,happiness/  copies just those folders (e.g. leave old boards behind).
  const only = process.argv.slice(2).find((a) => a.startsWith('--only='));
  if (only) PREFIXES = only.slice(7).split(',').map((x) => x.trim()).filter(Boolean);
  for (const k of ['BLOB_READ_WRITE_TOKEN', 'GITHUB_STATE_TOKEN']) {
    if (!process.env[k]) { console.error(`${k} is not set`); process.exit(2); }
  }
  const done = await migrate({
    blob: await import('@vercel/blob'),
    token: process.env.BLOB_READ_WRITE_TOKEN,
    gh: createGhStore({ env: process.env, cacheTtlMs: 0 }),
    dry: args.has('--dry-run'),
    overwrite: args.has('--overwrite'),
  });
  if (done.failed) process.exit(1);
}
