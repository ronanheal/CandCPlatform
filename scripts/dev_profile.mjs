#!/usr/bin/env node
// Headless-Chrome timing run against the local dev harness (zero dependencies; Node 22+).
//
//   node scripts/make_fake_data.mjs && node scripts/dev_server.mjs &   # fake data + server
//   node scripts/dev_profile.mjs [--url http://localhost:5178] [--throttle 4] [--json out.json]
//
// Starts Chrome headless with a throwaway profile, opens <url>/?api=1&perf=1 (dev_server.mjs then
// injects scripts/dev_perf.js, which defines __H), and times: initial load, navTo() and a sidebar
// click for every page, opening a job, typing in job search, ⌘K search, To Do week / person
// switches and Reporting tabs. Each row is the median of 3 runs: sync = the call itself, settle =
// until the frame showing the result has been drawn, longest = longest frame gap (see dev_perf.js). Set CHROME=/path/to/chrome if
// Chrome is not in the default macOS location.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));
const BASE = (args.url || 'http://localhost:5178').replace(/\/+$/, '');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-prof-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', '--no-default-browser-check',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch (e) { /* gone */ } try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ } };
process.on('exit', cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 50; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p) return p.webSocketDebuggerUrl; } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}
const ws = new WebSocket(await target());
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const waiting = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
async function ev(expr) {
  const d = await cdp('Runtime.evaluate', { expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true });
  if (d.result?.exceptionDetails) throw new Error(d.result.exceptionDetails.exception?.description || d.result.exceptionDetails.text);
  return d.result?.result?.value;
}
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
// --throttle 4: slow the CPU down 4x (roughly an older laptop), as in DevTools' Performance panel.
if (args.throttle) await cdp('Emulation.setCPUThrottlingRate', { rate: +args.throttle });

const rows = [];
async function load() {
  await cdp('Page.navigate', { url: `${BASE}/?api=1&perf=1` });
  for (let i = 0; i < 300; i++) { await sleep(100); try { const d = await ev('return window.__H&&__H.load.done'); if (d) return d; } catch (e) { /* navigating */ } }
  throw new Error('App did not finish loading');
}
// --cpu "<js>": profile that snippet (run 5 times after load) and print the top functions by
// self time and by total time, instead of the timing table. E.g. --cpu "navTo('schedule')".
async function cpu(expr) {
  await ev('await __H.idle(1500)');
  await cdp('Profiler.enable'); await cdp('Profiler.setSamplingInterval', { interval: 100 });
  await cdp('Profiler.start');
  await ev(`for(let i=0;i<5;i++){${expr};await __H.idle(400);}`);
  const { result } = await cdp('Profiler.stop');
  const nodes = new Map(result.profile.nodes.map((n) => [n.id, n]));
  const dt = {}; const samples = result.profile.samples, deltas = result.profile.timeDeltas;
  samples.forEach((id, i) => { dt[id] = (dt[id] || 0) + (deltas[i] || 0) / 1000; });
  const parent = new Map(); for (const n of nodes.values()) for (const c of n.children || []) parent.set(c, n.id);
  const self = {}, total = {};
  const key = (n) => `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber + 1}`;
  for (const [id, ms] of Object.entries(dt)) {
    let n = nodes.get(+id); const k = key(n); self[k] = (self[k] || 0) + ms;
    const seen = new Set();
    for (let cur = +id; cur != null; cur = parent.get(cur)) { const kk = key(nodes.get(cur)); if (!seen.has(kk)) { seen.add(kk); total[kk] = (total[kk] || 0) + ms; } }
  }
  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).filter(([k]) => !/^\((root|program|idle|garbage collector)\)/.test(k)).slice(0, 25).map(([k, v]) => `${(v / 5).toFixed(1).padStart(7)} ms  ${k}`).join('\n');
  console.log(`per run, self:\n${top(self)}\n\nper run, total:\n${top(total)}`);
}
// warm-up load (HTTP cache, server gzip cache), then the measured one
await load();
const loadMs = await load();
if (args.cpu) { await cpu(args.cpu); ws.close(); cleanup(); process.exit(0); }
// --eval file.js: run that file's body (an async function body) in the loaded app and print what it returns.
// --shot out.png (with or without --eval): save a screenshot of the page afterwards.
if (args.eval || args.shot) {
  if (args.eval) console.log(JSON.stringify(await ev(fs.readFileSync(args.eval, 'utf8')), null, 1));
  if (args.shot) { const { result } = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(args.shot, Buffer.from(result.data, 'base64')); }
  ws.close(); cleanup(); process.exit(0);
}
rows.push({ name: 'initial load → data in + first view drawn', sync: '', settle: loadMs, longest: '' });
await sleep(1500);

const scenarios = `
const H=__H,out=[];
out.push(...await H.pages());
// open a job (largest in-play job), from the Jobs list
const big=[...jobs].filter(j=>j.status==='inplay').sort((a,b)=>(b.phases||[]).reduce((s,p)=>s+p.items.length,0)-(a.phases||[]).reduce((s,p)=>s+p.items.length,0))[0];
out.push(await H.rep('open job', ()=>openJobDetail(big.id), 3, async()=>{navTo('jobs');}));
// typing in job search: one keystroke at a time
navTo('jobs');await H.idle();
{const inp=document.getElementById('jobs-search-inp');const ks=[];inp.value='';
 for(const c of 'brand'){await H.idle(150);ks.push(await H.measure(()=>{inp.value+=c;inp.dispatchEvent(new Event('input',{bubbles:true}));}));}
 out.push({name:'jobs search keystroke (median of 5)',sync:H.med(ks.map(x=>x.sync)),settle:H.med(ks.map(x=>x.settle)),longest:Math.max(...ks.map(x=>x.longest))});
 inp.value='';inp.dispatchEvent(new Event('input',{bubbles:true}));}
// Cmd+K
out.push(await H.rep('⌘K open', ()=>openGlobalSearch(), 3, async()=>{try{closeGlobalSearch();}catch(e){document.querySelector('.gs-bg,.gs-overlay')?.classList.remove('on');}}));
{const inp=document.getElementById('gs-inp');const ks=[];inp.value='';
 for(const c of 'brand'){await H.idle(150);ks.push(await H.measure(()=>{inp.value+=c;inp.dispatchEvent(new Event('input',{bubbles:true}));}));}
 out.push({name:'⌘K keystroke (median of 5)',sync:H.med(ks.map(x=>x.sync)),settle:H.med(ks.map(x=>x.settle)),longest:Math.max(...ks.map(x=>x.longest))});
 try{closeGlobalSearch();}catch(e){}}
// To Do: week and person
navTo('todo');await H.idle();
out.push(await H.rep('todo week back', ()=>toggleWeek(-1), 3, async()=>{weekOffset=0;renderTodo();}));
const others=Object.keys(people).filter(k=>k!==MY_PERSON&&!people[k]._archived&&people[k]._stId);
let pi=0;
out.push(await H.rep('todo switch person', ()=>{currentPerson=others[pi++%others.length];renderTodo();}, 3));
currentPerson=MY_PERSON;weekOffset=0;renderTodo();
// Reporting tabs
navTo('reporting');await H.idle(1000);
const repDone=t0=>H.lastRender>=t0;
for(const t of ['teams','people','jobs','clients','business']){
  out.push(await H.rep('report tab '+t, ()=>switchReportTab(t), 3, async()=>{switchReportTab(t==='business'?'teams':'business');await H.idle(300);}, repDone));
}
for(const t of ['people','business']){
  out.push(await H.rep('report tab click '+t, ()=>document.getElementById('rt-'+t).click(), 3, async()=>{switchReportTab(t==='business'?'teams':'business');await H.idle(300);}, repDone));
}
return out;`;
rows.push(...await ev(scenarios));

const w = Math.max(...rows.map((r) => r.name.length));
console.log(`${'scenario'.padEnd(w)}  ${'sync'.padStart(7)}  ${'settle'.padStart(7)}  ${'longest'.padStart(7)}   (ms)`);
for (const r of rows) console.log(`${r.name.padEnd(w)}  ${String(r.sync).padStart(7)}  ${String(r.settle).padStart(7)}  ${String(r.longest).padStart(7)}`);
if (args.json) fs.writeFileSync(args.json, JSON.stringify(rows, null, 1));
ws.close(); cleanup(); process.exit(0);
