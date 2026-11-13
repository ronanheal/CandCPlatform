// /api/access — the access list, admins only. Password hashes never leave the server.
//   GET  → {users, requests}
//   POST {action, email, ...}
//        add            {email, personKey, name, admin} → also returns {tempPassword} ONCE
//        resetPassword  {email}                         → returns a new {tempPassword} ONCE
//        update         {email, personKey, name}
//        setAdmin       {email, admin}
//        remove | approve | decline  {email}

import { adminEmailSet, applyAccessAction, publicAccess, json } from '../lib/auth.js';
import { requireUser, errorResponse, readJsonBody } from '../lib/guard.js';
import { getAccess, mutateAccess } from '../lib/store.js';
import { hashPassword, tempPassword } from '../lib/password.js';

const ACTIONS = new Set(['add', 'resetPassword', 'update', 'setAdmin', 'remove', 'approve', 'decline']);

export async function handle(request, opts = {}) {
  const env = opts.env || process.env;
  const o = { env, fetchImpl: opts.fetchImpl, blob: opts.blob };
  const adminEmails = adminEmailSet(env);
  if (request.method === 'GET') {
    const { response } = await requireUser(request, { ...o, admin: true });
    if (response) return response;
    try {
      return json(publicAccess(await getAccess({ ...o, fresh: true }), adminEmails));
    } catch (e) { return errorResponse(e); }
  }
  if (request.method === 'POST') {
    const { user, response } = await requireUser(request, { ...o, admin: true, csrf: true });
    if (response) return response;
    try {
      const body = await readJsonBody(request);
      if (!body || !ACTIONS.has(body.action)) return json({ error: 'Unknown action' }, 400);
      // The browser never chooses a password here; the server makes one and shows it once.
      const args = { action: body.action, email: body.email, personKey: body.personKey, name: body.name, admin: body.admin };
      let temp = null;
      if (body.action === 'add' || body.action === 'resetPassword') {
        temp = tempPassword();
        args.pw = await hashPassword(temp);
      }
      const doc = await mutateAccess((cur) => applyAccessAction(cur, args, user.email, adminEmails), `access: ${body.action}`, o);
      const out = publicAccess(doc, adminEmails);
      if (temp) out.tempPassword = temp;
      return json(out);
    } catch (e) { return errorResponse(e); }
  }
  return json({ error: 'Method not allowed' }, 405);
}

export function GET(request) { return handle(request); }
export function POST(request) { return handle(request); }
