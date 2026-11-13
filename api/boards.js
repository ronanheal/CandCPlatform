// /api/boards — shared Boards (lib/boards.js).
//   GET            → {boards:[...]} every board this person may see (admins-only boards: admins)
//   PUT | POST {board} → {board} the merged, saved copy. Same-origin only (CSRF).
// Removing a board is a save with board.removedAt set (kept as a tombstone so a stale copy in
// another browser can't bring it back).

import { json } from '../lib/auth.js';
import { requireUser, errorResponse, readJsonBody } from '../lib/guard.js';
import { listBoards, saveBoard, MAX_BOARD_BYTES } from '../lib/boards.js';

export async function handle(request, opts = {}) {
  const env = opts.env || process.env;
  const o = { env, fetchImpl: opts.fetchImpl, blob: opts.blob };
  if (request.method === 'GET') {
    const { user, response } = await requireUser(request, o);
    if (response) return response;
    try {
      return json({ boards: await listBoards(user, o), admin: !!user.admin });
    } catch (e) { return errorResponse(e); }
  }
  if (request.method === 'PUT' || request.method === 'POST') {
    const { user, response } = await requireUser(request, { ...o, csrf: true });
    if (response) return response;
    try {
      const body = await readJsonBody(request, MAX_BOARD_BYTES * 2);
      if (!body || typeof body !== 'object' || !body.board) return json({ error: 'Expected {board}' }, 400);
      return json({ board: await saveBoard(body.board, user, o) });
    } catch (e) { return errorResponse(e); }
  }
  return json({ error: 'Method not allowed' }, 405);
}

export function GET(request) { return handle(request); }
export function PUT(request) { return handle(request); }
export function POST(request) { return handle(request); }
