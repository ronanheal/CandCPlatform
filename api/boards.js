// /api/boards — shared Boards (lib/boards.js).
//   GET                 → {boards:[...], people:[{email,name,personKey}]} every board this person may
//                         see (admins-only boards: admins; "specific people" boards: those people,
//                         the creator and admins). people = the account list (no passwords), for
//                         the Share picker; it comes from the access list requireUser just read.
//   GET ?removed=1      → {boards:[...]} removed boards (admins only), for "Recently removed"
//   PUT | POST {board}  → {board} the merged, saved copy. Same-origin only (CSRF).
//   POST {action:'restore', id} → {board} brings a removed board back (admins only).
// Removing a board is a save with board.removedAt set (kept as a tombstone so a stale copy in
// another browser can't bring it back). Only the board's creator or an admin may do that.

import { json, normEmail } from '../lib/auth.js';
import { getAccess } from '../lib/store.js';
import { requireUser, errorResponse, readJsonBody } from '../lib/guard.js';
import { listBoards, saveBoard, restoreBoard, MAX_BOARD_BYTES } from '../lib/boards.js';

export async function handle(request, opts = {}) {
  const env = opts.env || process.env;
  const o = { env, fetchImpl: opts.fetchImpl, gh: opts.gh };
  if (request.method === 'GET') {
    const removed = new URL(request.url).searchParams.get('removed') === '1';
    const { user, response } = await requireUser(request, { ...o, admin: removed });
    if (response) return response;
    try {
      const boards = await listBoards(user, { ...o, removed });
      let people = [];
      try {
        const acc = await getAccess(o); // cached: requireUser has just read it
        people = ((acc && acc.users) || []).filter((u) => u && u.email)
          .map((u) => ({ email: normEmail(u.email), name: String(u.name || '').slice(0, 120), personKey: u.personKey || null }));
      } catch (e) { /* the picker falls back to emails already on the board */ }
      return json({ boards, people, admin: !!user.admin });
    } catch (e) { return errorResponse(e); }
  }
  if (request.method === 'PUT' || request.method === 'POST') {
    const { user, response } = await requireUser(request, { ...o, csrf: true });
    if (response) return response;
    try {
      const body = await readJsonBody(request, MAX_BOARD_BYTES * 2);
      if (body && body.action === 'restore') return json({ board: await restoreBoard(body.id, user, o) });
      if (!body || typeof body !== 'object' || !body.board) return json({ error: 'Expected {board}' }, 400);
      return json({ board: await saveBoard(body.board, user, o) });
    } catch (e) { return errorResponse(e); }
  }
  return json({ error: 'Method not allowed' }, 405);
}

export function GET(request) { return handle(request); }
export function PUT(request) { return handle(request); }
export function POST(request) { return handle(request); }
