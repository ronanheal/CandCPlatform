#!/usr/bin/env node
// Local dev harness: serves the app with production-scale FAKE data, no sign-in, no network.
//
//   node scripts/make_fake_data.mjs          # once: writes .devdata/ (gitignored)
//   node scripts/dev_server.mjs              # http://localhost:5178/?api=1
//   PORT=5200 DEV_AS=member node scripts/dev_server.mjs
//
// Open http://localhost:5178/?api=1 (the ?api=1 switches index.html from the raw-GitHub path to
// the /api path, exactly like the live site). Add &as=member to be a member without
// financial permissions instead of an admin (it sticks via a cookie; &as=admin switches back), or
// start the server with DEV_AS=member. Append &perf=1 to log page-switch timings to the console.
//
// What it does: serves the repo's static files; answers /api/data/<file>.json from .devdata/
// (gzipped, like production; money files 403 for a member); fakes /api/me and /api/auth/status as
// a signed-in person and sets the cc_who hint cookie; returns harmless empty answers for
// /api/boards, /api/happiness, /api/health, /api/access and /api/team/joins. It never talks to
// GitHub, Vercel or Streamtime, and never reads private/, dotfiles or keys.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { PERM_KEYS, PERM_GROUPS, permMask, fileNeeds } from '../lib/perms.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.resolve(process.env.DEVDATA || path.join(ROOT, '.devdata'));
const PORT = +(process.env.PORT || 5178);
const DEFAULT_AS = process.env.DEV_AS === 'member' ? 'member' : 'admin';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };

if (!fs.existsSync(path.join(DATA, 'jobs.json'))) console.warn(`No fake data in ${DATA} — run: node scripts/make_fake_data.mjs`);

let USERS = [];
try { USERS = JSON.parse(fs.readFileSync(path.join(DATA, 'users.json'), 'utf8')); } catch (e) { /* no data yet */ }
const MEMBER_PERMS = ['todo', 'viewTeamTodo', 'viewJobs', 'checkin'];
function who(as) {
  const u = USERS[as === 'member' ? 1 : 0] || { id: as === 'member' ? 1002 : 1001, firstName: 'Dev', lastName: as === 'member' ? 'Member' : 'Admin' };
  const perms = Object.fromEntries(PERM_KEYS.map((k) => [k, as === 'admin' || MEMBER_PERMS.includes(k)]));
  return { email: u.email || `dev.${as}@example.com`, name: `${u.firstName} ${u.lastName}`, personKey: 'st_' + u.id, admin: as === 'admin', perms };
}
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const whoCookie = (w) => `cc_who=${b64url({ e: w.email, n: w.name, p: w.personKey, a: w.admin, x: permMask(w.perms) })}; Path=/; SameSite=Lax`;
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));

const gzCache = new Map(); // file → {mtime, gz}
function dataFile(name) {
  const p = path.join(DATA, name);
  const st = fs.statSync(p, { throwIfNoEntry: false });
  if (!st) return null;
  const c = gzCache.get(name);
  if (c && c.mtime === st.mtimeMs) return c.gz;
  const gz = zlib.gzipSync(fs.readFileSync(p), { level: 6 });
  gzCache.set(name, { mtime: st.mtimeMs, gz });
  return gz;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers });
  res.end(body);
}
const json = (res, status, obj, headers = {}) => send(res, status, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8', ...headers });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  const asQ = url.searchParams.get('as');
  const as = asQ === 'member' || asQ === 'admin' ? asQ : (cookies(req).cc_dev_as === 'member' || cookies(req).cc_dev_as === 'admin' ? cookies(req).cc_dev_as : DEFAULT_AS);
  const me = who(as);
  const setCookies = [whoCookie(me), `cc_dev_as=${as}; Path=/; SameSite=Lax`];
  try {
    if (p.startsWith('/api/')) {
      const m = /^\/api\/data\/([a-z0-9_]+\.json)$/.exec(p);
      if (m) {
        const need = fileNeeds(m[1]);
        if (need && !me.perms[need]) return json(res, 403, { error: "You don't have permission for that", perm: need });
        const gz = dataFile(m[1]);
        if (!gz) return json(res, 404, { error: 'Not found' });
        return send(res, 200, gz, { 'content-type': 'application/json; charset=utf-8', 'content-encoding': 'gzip', 'content-length': gz.length });
      }
      if (p === '/api/me') {
        if (req.method === 'POST') return json(res, 200, { ok: true, onboarded: as, onboardedAt: new Date().toISOString() });
        return json(res, 200, { ...me, onboarded: as, ...(me.perms.userPermissions ? { permGroups: PERM_GROUPS.map((g) => ({ key: g.key, label: g.label, perms: g.perms.map(([key, label, hint]) => ({ key, label, hint })) })) } : {}) }, { 'set-cookie': setCookies });
      }
      if (p === '/api/auth/status') return json(res, 200, { state: 'signed-in', email: me.email, name: me.name, mustChangePassword: false });
      if (p.startsWith('/api/auth/')) return json(res, 200, { ok: true });
      if (p === '/api/boards') {
        if (req.method === 'GET') return json(res, 200, { boards: [], people: [], admin: me.admin });
        let body = ''; for await (const c of req) body += c;
        let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) { /* ignore */ }
        return json(res, 200, b.board ? { board: { ...b.board, updatedAt: Date.now() } } : { ok: true });
      }
      if (p === '/api/happiness') return json(res, 200, req.method === 'GET' ? { mine: [], responses: [], weeks: [], admin: me.admin, team: me.admin } : { ok: true });
      if (p === '/api/health') return json(res, 200, { status: 'ok', store: {}, stateCommits7d: 0, checkedAt: new Date().toISOString() });
      if (p === '/api/access') return json(res, 200, req.method === 'GET' ? { users: [], requests: [] } : { ok: true });
      if (p === '/api/team/joins') return json(res, 200, { joins: [] });
      return json(res, 404, { error: 'Not found (dev server)' });
    }
    // Static files from the repo root. No dotfiles, no private/, no .devdata, no traversal.
    if (p === '/__devperf.js') return send(res, 200, fs.readFileSync(path.join(ROOT, 'scripts', 'dev_perf.js')), { 'content-type': MIME['.js'] });
    if ((p === '/' || p === '/index.html') && url.searchParams.get('perf') === '1') {
      const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace('</head>', '<script src="/__devperf.js"></script></head>');
      return send(res, 200, html, { 'content-type': MIME['.html'], 'set-cookie': setCookies });
    }
    let rel = decodeURIComponent(p);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(ROOT, '.' + rel);
    const relToRoot = path.relative(ROOT, file);
    if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot) || relToRoot.split(path.sep).some((s) => s.startsWith('.') || s === 'private' || s === 'node_modules')) return send(res, 404, 'Not found');
    const st = fs.statSync(file, { throwIfNoEntry: false });
    if (!st || !st.isFile()) return send(res, 404, 'Not found');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'content-type': type };
    if (type.startsWith('text/html')) headers['set-cookie'] = setCookies;
    return send(res, 200, fs.readFileSync(file), headers);
  } catch (e) {
    return json(res, 500, { error: String(e && e.message || e) });
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`C&C dev server (fake data, signed in as ${DEFAULT_AS}) → http://localhost:${PORT}/?api=1`));
