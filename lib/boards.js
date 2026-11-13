// Shared boards: one encrypted blob per board, boards/<id>.json.enc, in the same private Vercel
// Blob store as the account list (lib/store.js), encrypted with DATA_KEY (lib/crypt.js).
//
// Visibility per board: 'everyone' (default) or 'admins' (only admins can read or write it).
// Writes are conditional on the ETag that was read. Every save is a merge of the stored board
// and the incoming one (by column and card ids, newest card updatedAt wins, tombstones in
// board.deleted win over older edits), so a browser that saved from a stale copy can't undo
// what someone else did. On an ETag conflict the server re-reads, merges again and retries.

import { dataKey, encryptJson, decryptJson } from './crypt.js';
import { blobSdk, streamToBuffer } from './store.js';

export const BOARD_PREFIX = 'boards/';
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TOMB_TTL_MS = 90 * 24 * 3600 * 1000;
export const MAX_BOARD_BYTES = 1_500_000;

const bad = (m, status = 400) => { const e = new Error(m); e.status = status; return e; };
export const boardPath = (id) => `${BOARD_PREFIX}${id}.json.enc`;
export const isBoardId = (id) => typeof id === 'string' && ID_RE.test(id);
export const visibilityOf = (b) => (b && b.visibility === 'admins' ? 'admins' : 'everyone');
export const canSee = (b, user) => visibilityOf(b) === 'everyone' || !!(user && user.admin);
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
const arr = (v) => (Array.isArray(v) ? v : []);

// Shape check + strip per-browser fields. Throws 400 on anything that isn't a board.
export function cleanBoard(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('Expected a board');
  if (!isBoardId(b.id)) throw bad('Bad board id');
  if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 200) throw bad('Bad board name');
  if (b.columns != null && !Array.isArray(b.columns)) throw bad('Bad columns');
  const out = { ...b };
  delete out.openedAt; delete out.shared; delete out._sync;
  out.visibility = visibilityOf(b);
  out.columns = arr(b.columns).filter((c) => c && typeof c === 'object' && typeof c.id === 'string').map((c) => ({
    ...c, cards: arr(c.cards).filter((k) => k && typeof k === 'object' && typeof k.id === 'string'),
  }));
  if (out.columns.length > 200) throw bad('Too many columns');
  out.deleted = (b.deleted && typeof b.deleted === 'object' && !Array.isArray(b.deleted)) ? { ...b.deleted } : {};
  out.updatedAt = num(b.updatedAt);
  return out;
}

function mergeTombs(a, b, now) {
  const out = {};
  for (const t of [a || {}, b || {}]) for (const [id, ts] of Object.entries(t)) {
    if (typeof ts !== 'number' || now - ts > TOMB_TTL_MS) continue;
    if (!(id in out) || ts > out[id]) out[id] = ts;
  }
  return out;
}

// Pure merge. base = stored copy (may be null), inc = incoming. Returns a new board.
export function mergeBoards(base, inc, now = Date.now()) {
  if (!base) return { ...inc, deleted: mergeTombs(null, inc.deleted, now) };
  const incNewer = num(inc.updatedAt) >= num(base.updatedAt);
  const newer = incNewer ? inc : base, older = incNewer ? base : inc;
  const deleted = mergeTombs(base.deleted, inc.deleted, now);
  const dead = (id, ts) => id in deleted && deleted[id] >= num(ts);

  // Column order: the newer board's, with columns only the older one has slotted in after
  // their previous neighbour. Column props: the copy with the later col.updatedAt.
  const nCols = arr(newer.columns), oCols = arr(older.columns);
  const order = nCols.map((c) => c.id);
  oCols.forEach((c, i) => {
    if (order.includes(c.id)) return;
    let at = order.length;
    for (let j = i - 1; j >= 0; j--) { const k = order.indexOf(oCols[j].id); if (k >= 0) { at = k + 1; break; } }
    order.splice(at, 0, c.id);
  });
  const colById = (list, id) => list.find((c) => c.id === id);
  const cols = [];
  for (const id of order) {
    const n = colById(nCols, id), o = colById(oCols, id);
    const pick = n && o ? (num(o.updatedAt) > num(n.updatedAt) ? o : n) : (n || o);
    if (dead(id, pick.updatedAt)) continue;
    cols.push({ ...pick, cards: [] });
  }

  // Cards: newest updatedAt wins (ties go to the newer board); it lives where the winner put it.
  const win = new Map();
  for (const [src, isNewer] of [[newer, true], [older, false]]) {
    for (const col of arr(src.columns)) for (const card of arr(col.cards)) {
      if (dead(card.id, card.updatedAt)) continue;
      const w = win.get(card.id);
      if (!w || num(card.updatedAt) > num(w.card.updatedAt) || (num(card.updatedAt) === num(w.card.updatedAt) && isNewer && !w.isNewer)) {
        win.set(card.id, { card, colId: col.id, isNewer });
      }
    }
  }
  for (const col of cols) {
    const placed = new Set();
    for (const src of [newer, older]) {
      const sc = colById(arr(src.columns), col.id); if (!sc) continue;
      for (const card of arr(sc.cards)) {
        const w = win.get(card.id);
        if (!w || w.colId !== col.id || placed.has(card.id)) continue;
        col.cards.push(w.card); placed.add(card.id);
      }
    }
  }
  // Cards whose winning column no longer exists are dropped with that column.

  const out = { ...older, ...newer, columns: cols, deleted, updatedAt: Math.max(num(base.updatedAt), num(inc.updatedAt)) };
  out.createdAt = Math.min(num(base.createdAt) || Infinity, num(inc.createdAt) || Infinity);
  if (!isFinite(out.createdAt)) delete out.createdAt;
  // Visibility: the most recent explicit change wins.
  const vb = num(base.visibilityAt), vi = num(inc.visibilityAt);
  out.visibility = visibilityOf(vi > vb ? inc : vb > vi ? base : newer);
  out.visibilityAt = Math.max(vb, vi) || undefined;
  // Removing a board sticks (a stale copy can't bring it back).
  const rm = Math.max(num(base.removedAt), num(inc.removedAt));
  if (rm) out.removedAt = rm; else delete out.removedAt;
  return out;
}

// ── Blob I/O ─────────────────────────────────────────────────────────────────────────────────
async function readRaw(id, opts) {
  const env = opts.env || process.env;
  const key = dataKey(env);
  const s = await blobSdk(opts);
  let res;
  try {
    res = await s.get(boardPath(id), { access: 'private', useCache: false });
  } catch (e) {
    if (s.BlobNotFoundError && e instanceof s.BlobNotFoundError) res = null;
    else throw bad('Board store unavailable', 503);
  }
  if (!res || res.statusCode !== 200 || !res.stream) return { board: null, etag: null };
  return { board: decryptJson(await streamToBuffer(res.stream), key), etag: res.blob.etag };
}

export async function readBoard(id, opts = {}) {
  if (!isBoardId(id)) throw bad('Bad board id');
  return (await readRaw(id, opts)).board;
}

// Every board the user may see (removed boards left out).
export async function listBoards(user, opts = {}) {
  const s = await blobSdk(opts);
  dataKey(opts.env || process.env);
  const ids = [];
  let cursor;
  try {
    do {
      const page = await s.list({ prefix: BOARD_PREFIX, cursor, limit: 1000 });
      for (const b of page.blobs || []) {
        const m = /^boards\/([A-Za-z0-9_-]{1,64})\.json\.enc$/.exec(b.pathname || '');
        if (m) ids.push(m[1]);
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } catch (e) {
    throw bad('Board store unavailable', 503);
  }
  const boards = await Promise.all(ids.map((id) => readRaw(id, opts).then((r) => r.board).catch(() => null)));
  return boards.filter((b) => b && !b.removedAt && canSee(b, user));
}

// Merge-save one board for this user. Enforces visibility on the stored and incoming copy.
export async function saveBoard(incoming, user, opts = {}) {
  const env = opts.env || process.env;
  const key = dataKey(env);
  const s = await blobSdk(opts);
  const inc = cleanBoard(incoming);
  for (let attempt = 0; attempt < 4; attempt++) {
    const { board: cur, etag } = await readRaw(inc.id, opts);
    if (cur && !canSee(cur, user)) throw bad('Admins only', 403);
    if (!user.admin) {
      const want = visibilityOf(inc), have = cur ? visibilityOf(cur) : 'everyone';
      if (want !== have) throw bad('Only admins can change who sees a board', 403);
      if (cur) { inc.visibilityAt = cur.visibilityAt; }
    }
    const next = mergeBoards(cur, inc);
    const body = encryptJson(next, key);
    if (body.length > MAX_BOARD_BYTES) throw bad('Board too large', 413);
    const o = { access: 'private', contentType: 'application/octet-stream', addRandomSuffix: false, cacheControlMaxAge: 60 };
    if (etag) o.ifMatch = etag;
    try {
      await s.put(boardPath(inc.id), body, o);
      return next;
    } catch (e) {
      const conflict = e && ((s.BlobPreconditionFailedError && e instanceof s.BlobPreconditionFailedError) || /already exists|precondition/i.test(String(e.message)));
      if (!conflict || attempt === 3) {
        if (e && e.status) throw e;
        throw bad('Could not save the board', 503);
      }
    }
  }
}
