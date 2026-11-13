// Shared boards: one encrypted blob per board, boards/<id>.json.enc, in the same private Vercel
// Blob store as the account list (lib/store.js), encrypted with STORE_KEY (falls back to
// DATA_KEY; lib/crypt.js).
//
// Visibility per board: 'everyone' (default) or 'admins' (only admins can read or write it).
// Writes are conditional on the ETag that was read. Every save is a merge of the stored board
// and the incoming one (by column and card ids, newest card updatedAt wins, tombstones in
// board.deleted win over older edits), so a browser that saved from a stale copy can't undo
// what someone else did. On an ETag conflict the server re-reads, merges again and retries.
//
// Every incoming board is rebuilt field by field from a whitelist (cleanBoard): known fields
// only, typed, length-capped, colours from the palette, ids [A-Za-z0-9_-]. The browser renders
// these into HTML, so nothing else a client sends ever reaches another person's page.
//
// Removing a board (removedAt) is allowed for the person who created it (createdBy, set here on
// create) and for admins. Admins can list removed boards (?removed=1) and restore them.

import { storeKey, encryptJson, decryptStoreJson } from './crypt.js';
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

// ── Whitelist ────────────────────────────────────────────────────────────────────────────
export const COLORS = ['grey', 'blue', 'amber', 'purple', 'green', 'red', 'teal', 'pink'];
const STAGES = ['quote', 'live', 'completed', 'invoiced'];
const SORTS = ['manual', 'due', 'updated', 'title'];
const BOARD_TYPES = ['custom', 'client', 'people', 'wip'];
export const LIMITS = {
  columns: 100, cards: 5000, checklists: 20, items: 300, labels: 30, assignees: 50, comments: 500,
  activity: 100, ignoreJobs: 5000, deleted: 20000, notes: 500,
  name: 200, title: 500, desc: 20000, text: 5000, item: 1000, label: 60, key: 64, email: 254,
};
const tooMany = (what) => bad(`Too many ${what}`, 413);
// Plain text, control characters (except tab/newline) removed, capped.
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max) : undefined);
const oneLine = (v, max) => { const t = str(v, max); return t === undefined ? undefined : t.replace(/[\r\n\t]+/g, ' '); };
const bool = (v) => (v === true ? true : undefined);
const fin = (v) => (typeof v === 'number' && isFinite(v) ? v : undefined);
const key = (v) => (typeof v === 'string' && ID_RE.test(v) ? v : typeof v === 'number' && Number.isInteger(v) && v >= 0 ? String(v) : undefined);
const oneOf = (v, list) => (list.includes(v) ? v : undefined);
const isoDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
// Drop undefined fields so the stored JSON only holds what was set.
const pack = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o; };
function list(v, max, what, fn) {
  const a = arr(v);
  if (a.length > max) throw tooMany(what);
  return a.map(fn).filter((x) => x !== undefined && x !== null);
}
const strList = (v, max, what, len) => [...new Set(list(v, max, what, (x) => oneLine(x, len)).filter(Boolean))];

function cleanItem(i) {
  if (!i || typeof i !== 'object' || !isBoardId(i.id)) return null;
  return pack({ id: i.id, text: str(i.text, LIMITS.item) ?? '', done: bool(i.done) });
}
function cleanCard(k) {
  if (!k || typeof k !== 'object' || Array.isArray(k) || !isBoardId(k.id)) return null;
  return pack({
    id: k.id,
    type: oneOf(k.type, ['card', 'client', 'person']) || 'card',
    kind: oneOf(k.kind, ['job', 'note']),
    title: str(k.title, LIMITS.title) ?? '',
    desc: str(k.desc, LIMITS.desc) ?? '',
    note: str(k.note, LIMITS.desc),
    jobRef: key(k.jobRef),
    jobNumber: oneLine(k.jobNumber, LIMITS.key),
    clientRef: oneLine(k.clientRef, LIMITS.name),
    clientId: key(k.clientId),
    personRef: key(k.personRef),
    role: oneLine(k.role, LIMITS.name),
    email: oneLine(k.email, LIMITS.email),
    due: isoDate(k.due),
    assignees: strList(k.assignees, LIMITS.assignees, 'assignees', LIMITS.key).filter((x) => ID_RE.test(x)),
    labels: strList(k.labels, LIMITS.labels, 'labels', LIMITS.label),
    checklistTitle: oneLine(k.checklistTitle, LIMITS.name),
    checklist: list(k.checklist, LIMITS.items, 'checklist items', cleanItem),
    checklists: k.checklists === undefined ? undefined : list(k.checklists, LIMITS.checklists, 'checklists', (l) => (
      l && typeof l === 'object' && isBoardId(l.id)
        ? { id: l.id, title: oneLine(l.title, LIMITS.name) ?? '', items: list(l.items, LIMITS.items, 'checklist items', cleanItem) }
        : null)),
    comments: list(k.comments, LIMITS.comments, 'comments', (m) => (
      m && typeof m === 'object' && isBoardId(m.id)
        ? pack({ id: m.id, by: key(m.by), text: str(m.text, LIMITS.text) ?? '', ts: fin(m.ts) ?? 0 })
        : null)),
    // Activity is a log the browser trims itself; keep the newest entries rather than refusing.
    activity: arr(k.activity).slice(-LIMITS.activity).map((a) => (
      a && typeof a === 'object' ? pack({ ts: fin(a.ts) ?? 0, by: key(a.by), text: oneLine(a.text, LIMITS.item) ?? '' }) : null)).filter(Boolean),
    collapsed: bool(k.collapsed),
    archived: bool(k.archived),
    archivedAt: fin(k.archivedAt),
    createdAt: fin(k.createdAt),
    updatedAt: fin(k.updatedAt) ?? 0,
  });
}
function cleanColumn(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c) || !isBoardId(c.id)) return null;
  const wip = typeof c.wip === 'number' ? c.wip : parseInt(c.wip, 10);
  return pack({
    id: c.id,
    name: oneLine(c.name, LIMITS.name) ?? '',
    color: oneOf(c.color, COLORS) || 'grey',
    wip: Number.isInteger(wip) && wip > 0 && wip <= 9999 ? wip : undefined,
    done: bool(c.done),
    collapsed: bool(c.collapsed),
    stage: oneOf(c.stage, STAGES),
    updatedAt: fin(c.updatedAt),
    cards: list(c.cards, LIMITS.cards, 'cards', cleanCard),
  });
}

// Rebuild a board from the whitelist. Throws 400 on anything that isn't a board and 413 when a
// list is over its limit. Unknown fields (and per-browser ones like openedAt/shared) are dropped.
export function cleanBoard(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('Expected a board');
  if (!isBoardId(b.id)) throw bad('Bad board id');
  if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > LIMITS.name) throw bad('Bad board name');
  if (b.columns != null && !Array.isArray(b.columns)) throw bad('Bad columns');
  const columns = list(b.columns, LIMITS.columns, 'columns', cleanColumn);
  if (columns.reduce((n, c) => n + c.cards.length, 0) > LIMITS.cards) throw tooMany('cards');
  const deleted = {};
  if (b.deleted && typeof b.deleted === 'object' && !Array.isArray(b.deleted)) {
    const ents = Object.entries(b.deleted).filter(([id, ts]) => isBoardId(id) && fin(ts) !== undefined);
    if (ents.length > LIMITS.deleted) throw tooMany('deleted items');
    for (const [id, ts] of ents) deleted[id] = ts;
  }
  let notes;
  if (b.notes && typeof b.notes === 'object' && !Array.isArray(b.notes)) {
    const ents = Object.entries(b.notes).filter(([k, v]) => ID_RE.test(k) && typeof v === 'string');
    if (ents.length > LIMITS.notes) throw tooMany('notes');
    notes = Object.fromEntries(ents.map(([k, v]) => [k, str(v, LIMITS.desc)]));
  }
  return pack({
    id: b.id,
    v: fin(b.v) ?? 2,
    name: oneLine(b.name, LIMITS.name).trim(),
    type: oneOf(b.type, BOARD_TYPES) || 'custom',
    template: typeof b.template === 'string' && /^[a-z0-9_-]{1,40}$/i.test(b.template) ? b.template : undefined,
    studio: bool(b.studio),
    client: oneLine(b.client, LIMITS.name),
    clientFilter: oneLine(b.clientFilter, LIMITS.name),
    wip: oneOf(b.wip, ['business', 'team']),
    groupBy: typeof b.groupBy === 'string' && /^[a-z0-9_-]{1,40}$/i.test(b.groupBy) ? b.groupBy : undefined,
    hideInternal: bool(b.hideInternal),
    sort: oneOf(b.sort, SORTS),
    archived: bool(b.archived),
    ignoreJobs: strList(b.ignoreJobs, LIMITS.ignoreJobs, 'ignored jobs', LIMITS.key),
    notes,
    visibility: visibilityOf(b),
    visibilityAt: fin(b.visibilityAt),
    removedAt: fin(b.removedAt),
    restoredAt: fin(b.restoredAt),
    createdAt: fin(b.createdAt),
    updatedAt: fin(b.updatedAt) ?? 0,
    columns,
    deleted,
  });
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
  // Removing a board sticks (a stale copy can't bring it back), unless an admin restored it
  // after that removal.
  const rm = Math.max(num(base.removedAt), num(inc.removedAt));
  const rs = Math.max(num(base.restoredAt), num(inc.restoredAt));
  if (rm && rm > rs) out.removedAt = rm; else delete out.removedAt;
  if (rs) out.restoredAt = rs; else delete out.restoredAt;
  // Who created it is fixed by the stored copy (saveBoard sets it on create).
  if (base.createdBy) out.createdBy = base.createdBy; else delete out.createdBy;
  return out;
}

// ── Blob I/O ─────────────────────────────────────────────────────────────────────────────────
// Stored copies go through the same whitelist on the way out, so anything saved before it
// existed can't reach a browser either. createdBy is the one server-set field kept.
function fromStore(b) {
  try {
    const out = cleanBoard(b);
    if (typeof b.createdBy === 'string' && b.createdBy.length <= 254) out.createdBy = b.createdBy;
    return out;
  } catch (e) {
    return null;
  }
}

async function readRaw(id, opts) {
  const env = opts.env || process.env;
  const key = storeKey(env);
  const s = await blobSdk(opts);
  let res;
  try {
    res = await s.get(boardPath(id), { access: 'private', useCache: false });
  } catch (e) {
    if (s.BlobNotFoundError && e instanceof s.BlobNotFoundError) res = null;
    else throw bad('Board store unavailable', 503);
  }
  if (!res || res.statusCode !== 200 || !res.stream) return { board: null, etag: null };
  return { board: fromStore(decryptStoreJson(await streamToBuffer(res.stream), key, 'a board')), etag: res.blob.etag };
}

export async function readBoard(id, opts = {}) {
  if (!isBoardId(id)) throw bad('Bad board id');
  return (await readRaw(id, opts)).board;
}

// Every board the user may see (removed boards left out). opts.removed → only the removed ones
// (admins; the API checks).
export async function listBoards(user, opts = {}) {
  const s = await blobSdk(opts);
  storeKey(opts.env || process.env);
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
  // One unreadable board is skipped, but a key mismatch fails the whole list: an empty list
  // would make every browser drop its copies of the shared boards.
  const boards = await Promise.all(ids.map((id) => readRaw(id, opts).then((r) => r.board).catch((e) => { if (e && e.expose) throw e; return null; })));
  return boards.filter((b) => b && !!b.removedAt === !!opts.removed && canSee(b, user));
}

// Merge-save one board for this user. Enforces visibility on the stored and incoming copy.
export const canRemove = (b, user) => !!(user && (user.admin || (b && b.createdBy && b.createdBy === user.email)));
const isRemoved = (b) => !!(b && b.removedAt && b.removedAt > num(b.restoredAt));

export async function saveBoard(incoming, user, opts = {}) {
  const env = opts.env || process.env;
  const key = storeKey(env);
  const s = await blobSdk(opts);
  const clean = cleanBoard(incoming);
  delete clean.restoredAt; // only restoreBoard sets it
  for (let attempt = 0; attempt < 4; attempt++) {
    const inc = { ...clean };
    const { board: cur, etag } = await readRaw(inc.id, opts);
    if (cur && !canSee(cur, user)) throw bad('Admins only', 403);
    if (!user.admin) {
      const want = visibilityOf(inc), have = cur ? visibilityOf(cur) : 'everyone';
      if (want !== have) throw bad('Only admins can change who sees a board', 403);
      if (cur) { inc.visibilityAt = cur.visibilityAt; }
    }
    // Removing: only the creator or an admin. A save that carries the removal the stored copy
    // already has is not a new removal; a board removed before its first save is the saver's own.
    if (inc.removedAt && cur && !isRemoved(cur) && inc.removedAt > num(cur.restoredAt) && !canRemove(cur, user)) {
      throw bad('Only the person who created this board, or an admin, can delete it', 403);
    }
    const next = mergeBoards(cur, inc);
    if (!cur) next.createdBy = user.email;
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

// Admins: bring a removed board back for everyone. restoredAt outranks the removal, so a stale
// browser re-sending the old removedAt can't remove it again.
export async function restoreBoard(id, user, opts = {}) {
  if (!user || !user.admin) throw bad('Admins only', 403);
  if (!isBoardId(id)) throw bad('Bad board id');
  const env = opts.env || process.env;
  const key = storeKey(env);
  const s = await blobSdk(opts);
  for (let attempt = 0; attempt < 4; attempt++) {
    const { board: cur, etag } = await readRaw(id, opts);
    if (!cur) throw bad('No such board', 404);
    if (!isRemoved(cur)) return cur;
    const now = Date.now();
    const next = { ...cur, restoredAt: Math.max(now, num(cur.removedAt) + 1), updatedAt: Math.max(now, num(cur.updatedAt) + 1) };
    delete next.removedAt;
    try {
      await s.put(boardPath(id), encryptJson(next, key), { access: 'private', contentType: 'application/octet-stream', addRandomSuffix: false, cacheControlMaxAge: 60, ifMatch: etag });
      return next;
    } catch (e) {
      const conflict = e && ((s.BlobPreconditionFailedError && e instanceof s.BlobPreconditionFailedError) || /precondition/i.test(String(e.message)));
      if (!conflict || attempt === 3) { if (e && e.status) throw e; throw bad('Could not restore the board', 503); }
    }
  }
}
