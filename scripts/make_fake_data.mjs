#!/usr/bin/env node
// Fake Streamtime data at production scale, for profiling the app locally.
//
//   node scripts/make_fake_data.mjs [--out .devdata] [--seed 42] [--scale 1]
//
// Writes the same files the hourly sync publishes (jobs.json, logged_times.json, users.json,
// companies.json, contacts.json, quotes.json, invoices.json, expenses.json, job_assignments.json,
// milestones.json, scheduled_todos.json, sync_meta.json, logged_times_sweep.json) with the field
// names and shapes index.html reads (see scripts/jobs_slim.py, record_slim.py,
// logged_times_sweep.py slim(), and _mapStJob / _mapStCompany / initStreamtime in index.html).
// Every name is obviously fake (Testerson, Placeholder Ltd, example.com). Deterministic per seed.
// Dates are relative to today, so "this week" always has data. Serve it with
// scripts/dev_server.mjs. The output folder (.devdata/) is gitignored.

import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));
const OUT = path.resolve(args.out || '.devdata');
const SCALE = +(args.scale || 1);
let seed = +(args.seed || 42) >>> 0;
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = new Date(); today.setHours(0, 0, 0, 0);
const weekday = (d) => { const x = new Date(d); while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() - 1); return x; };

const N = {
  users: 40, companies: Math.round(300 * SCALE), contacts: Math.round(700 * SCALE),
  jobs: Math.round(2500 * SCALE), times: Math.round(60000 * SCALE), quotes: Math.round(800 * SCALE),
  invoices: Math.round(1500 * SCALE), expenses: Math.round(3000 * SCALE), milestones: 60,
};

const FIRST = ['Ada', 'Bram', 'Cleo', 'Dex', 'Esme', 'Finn', 'Gus', 'Hana', 'Ivo', 'Juno', 'Kit', 'Lark', 'Milo', 'Nell', 'Otto', 'Pia', 'Quin', 'Rosa', 'Sol', 'Tess', 'Uma', 'Vic', 'Wren', 'Xan', 'Yara', 'Zed'];
const LAST = ['Testerson', 'Placeholder', 'Sampleton', 'Dummyworth', 'Mockridge', 'Fakesley', 'Stubbins', 'Fixturely', 'Lorem', 'Ipsumson', 'Examplar', 'Demoford'];
const ROLES = ['Designer', 'Senior Designer', 'Writer', 'Producer', 'Account Manager', 'Developer', 'Strategist', 'Studio Manager'];
const CO_A = ['Acme', 'Placeholder', 'Example', 'Fictional', 'Imaginary', 'Sample', 'Dummy', 'Mock', 'Testbed', 'Notreal', 'Hypothetical', 'Pretend', 'Madeup', 'Lorem', 'Generic'];
const CO_B = ['Widgets', 'Foods', 'Holdings', 'Council', 'Trust', 'Logistics', 'Health', 'Energy', 'Studios', 'Partners', 'Ventures', 'Dairy', 'Wines', 'Transport', 'Insurance', 'Academy', 'Group'];
const CO_C = ['Ltd', 'Co', 'Inc', 'NZ', 'Ltd', 'Limited'];
const JOB_W = ['Brand refresh', 'Annual report', 'Website build', 'Campaign', 'Social content', 'Retainer', 'Brochure', 'Video edit', 'Signage', 'Newsletter', 'Strategy workshop', 'Packaging', 'Event collateral', 'Photography', 'Copywriting', 'Infographics', 'Pitch deck', 'Style guide'];
const PHASES = ['Discovery', 'Concept', 'Design', 'Development', 'Production', 'Delivery', 'Project management', 'Amends'];
const ITEMS = ['Design', 'Copywriting', 'Art direction', 'Account management', 'Artwork', 'Proofing', 'Development', 'Strategy', 'Photography', 'Retouching', 'Animation', 'Editing', 'Meetings', 'Print management', 'QA', 'Research'];
const LABELS = ['Digital', 'Print', 'Brand', 'Video', 'Retainer', 'Urgent', 'Internal', 'Pro bono'];
const NOTES = ['Worked on layouts', 'Client feedback round', 'First draft', 'Revisions', 'Internal review', 'Prep for presentation', 'Final artwork', 'Call with client', '', '', ''];

// ── users ──
const users = [];
for (let i = 0; i < N.users; i++) {
  const fn = FIRST[i % FIRST.length], ln = LAST[(i * 7) % LAST.length] + (i >= FIRST.length ? ' II' : '');
  const part = i % 9 === 4;
  const h = part ? 6 : 8;
  users.push({
    id: 1001 + i, firstName: fn, lastName: ln, displayName: `${fn} ${ln}`, email: `${fn}.${ln.replace(/\W/g, '')}@example.com`.toLowerCase(),
    userStatus: { name: i >= N.users - 4 ? 'Hibernated' : 'Active' },
    hoursWorkedMonday: h, hoursWorkedTuesday: h, hoursWorkedWednesday: h, hoursWorkedThursday: h, hoursWorkedFriday: part ? 0 : h,
    billableRate: pick([150, 165, 180, 195, 220]), ...(i % 10 === 0 ? { costRate: 95 } : {}),
    roles: [{ name: ROLES[i % ROLES.length] }],
  });
}
const activeUsers = users.filter((u) => u.userStatus.name === 'Active');

// ── companies + contacts ──
const companies = [];
const usedCo = new Set();
for (let i = 0; i < N.companies; i++) {
  let name; do { name = `${pick(CO_A)} ${pick(CO_B)} ${pick(CO_C)}`; if (usedCo.has(name)) name += ' ' + (i + 1); } while (usedCo.has(name));
  usedCo.add(name);
  companies.push({ id: 5001 + i, name, websiteAddress: `https://www.example.com/c${i}`, phone1: `09 555 ${String(1000 + i).slice(-4)}`,
    physicalAddress: { line1: `${ri(1, 300)} Example Street`, city: pick(['Testville', 'Sampleton', 'Mocksford']), postCode: String(ri(1000, 9999)), countryName: 'New Zealand' } });
}
const contacts = [];
for (let i = 0; i < N.contacts; i++) {
  const c = companies[i % companies.length];
  const fn = pick(FIRST), ln = pick(LAST);
  contacts.push({ id: 7001 + i, companyId: c.id, company: { id: c.id, name: c.name }, firstName: fn, lastName: ln, email: `${fn}.${ln}.${i}@example.com`.toLowerCase(), phoneNumber: `021 555 ${String(i).padStart(4, '0')}`, position: pick(['Marketing Manager', 'CEO', 'Comms Lead', 'Brand Manager']), contactStatus: { name: chance(0.1) ? 'Archived' : 'Active' } });
}

// ── jobs (with phases/items) ──
// Company popularity is skewed: a few big clients own many jobs.
const coWeighted = companies.flatMap((c, i) => Array(i < 20 ? 12 : i < 80 ? 3 : 1).fill(c));
const jobs = [];
let itemId = 900001, phaseId = 800001;
for (let i = 0; i < N.jobs; i++) {
  const number = 2000 + i;
  const ageDays = Math.round((1 - i / N.jobs) * 1500) + ri(-10, 10); // newer jobs have higher numbers
  const start = addDays(today, -Math.max(0, ageDays));
  const end = addDays(start, ri(14, 120));
  const r = rnd();
  const status = ageDays < 120 ? (r < 0.75 ? 'In Play' : r < 0.82 ? 'Paused' : 'Complete') : ageDays < 400 ? (r < 0.2 ? 'In Play' : r < 0.7 ? 'Complete' : 'Archived') : (r < 0.03 ? 'In Play' : r < 0.4 ? 'Complete' : 'Archived');
  const co = pick(coWeighted);
  const j = {
    id: 300000 + i, number, name: `${pick(JOB_W)} ${start.getFullYear()}${chance(0.3) ? ' – ' + pick(['Phase 2', 'Autumn', 'Spring', 'Launch', 'Refresh']) : ''}`,
    isBillable: !chance(0.06), estimatedStartDate: iso(start), estimatedEndDate: iso(end),
    company: { name: co.name }, jobStatus: { name: status },
    _coId: co.id,
  };
  if (chance(0.3)) j.purchaseOrderNumber = 'PO-' + ri(10000, 99999);
  if (chance(0.5)) j.jobLabels = [{ name: pick(LABELS) }];
  const team = Array.from(new Set(Array.from({ length: ri(1, 5) }, () => pick(activeUsers).id)));
  j.users = team.map((id) => ({ id }));
  j._team = team;
  j.phases = [];
  const nPh = ri(1, 4);
  for (let p = 0; p < nPh; p++) {
    const ph = { id: phaseId++, name: PHASES[p % PHASES.length], items: [] };
    const nIt = ri(1, 6);
    for (let k = 0; k < nIt; k++) {
      const planM = ri(1, 40) * 30;
      const s = addDays(start, ri(0, 20)), e = addDays(s, ri(5, 60));
      const it = { id: itemId++, name: pick(ITEMS), sellRate: pick([150, 165, 180, 195]), totalPlannedMinutes: planM, estimatedStartDate: iso(s), estimatedEndDate: iso(e) };
      if (chance(0.15)) it.description = 'Fake description for testing only.';
      if (status === 'Complete' || status === 'Archived') it.jobItemStatus = { name: 'Complete' };
      else if (chance(0.2)) it.jobItemStatus = { name: 'Complete' };
      else if (chance(0.3)) it.jobItemStatus = { name: 'In Progress' };
      ph.items.push(it);
    }
    j.phases.push(ph);
  }
  j.looseItems = chance(0.1) ? [{ id: itemId++, name: 'General', sellRate: 165, totalPlannedMinutes: 120 }] : [];
  j._items = j.phases.flatMap((p) => p.items).concat(j.looseItems);
  j._start = start; j._end = end;
  jobs.push(j);
}

// ── logged times ──
// Dates spread evenly over the last 12 months (weekdays); each entry goes to a job that was
// running that week (in-play jobs weighted up), so every week looks like a normal week.
const yearAgo = addDays(today, -365);
const timeJobs = jobs.filter((j) => j._end >= addDays(yearAgo, -30));
const timeW = timeJobs.flatMap((j) => Array(j.jobStatus.name === 'In Play' ? 5 : 1).fill(j));
const byWeek = new Map();
for (let w = 0; w <= 53; w++) {
  const ws = addDays(yearAgo, w * 7), we = addDays(ws, 7);
  const c = timeW.filter((j) => j._start <= we && addDays(j._end, 30) >= ws);
  byWeek.set(w, c.length ? c : timeW);
}
const logged = [];
for (let i = 0; i < N.times; i++) {
  const d = weekday(addDays(yearAgo, ri(0, 365)));
  const j = pick(byWeek.get(Math.floor((d - yearAgo) / (7 * 864e5))) || timeW);
  const it = pick(j._items);
  const uid = chance(0.85) ? pick(j._team) : pick(activeUsers).id;
  const minutes = ri(1, 8) * 15;
  const rate = it.sellRate || 165;
  logged.push({ id: 10000000 + i, userId: uid, date: iso(d), minutes, notes: pick(NOTES) || null, scheduleNotes: null, itemName: it.name,
    totalExTax: Math.round(minutes / 60 * rate * 100) / 100, completedDatetime: iso(d) + 'T05:00:00Z', loggedTimeStatus: { name: 'Logged' },
    job: { id: j.id, number: j.number, name: j.name, isBillable: j.isBillable }, jobItemUser: { jobItemId: it.id } });
  it.totalLoggedMinutes = (it.totalLoggedMinutes || 0) + minutes;
  j.totalLoggedMinutes = (j.totalLoggedMinutes || 0) + minutes;
  j.totalLoggedTimeExTax = Math.round(((j.totalLoggedTimeExTax || 0) + minutes / 60 * rate) * 100) / 100;
}
logged.sort((a, b) => (a.date < b.date ? -1 : 1));

// ── scheduled todos (planned blocks, -2..+4 weeks) ──
const scheduled = [];
let sid = 20000000;
for (const u of activeUsers) {
  const myJobs = jobs.filter((j) => j.jobStatus.name === 'In Play' && j._team.includes(u.id));
  if (!myJobs.length) continue;
  for (let d = -14; d <= 28; d++) {
    const day = addDays(today, d); if (day.getDay() === 0 || day.getDay() === 6) continue;
    for (let k = ri(1, 4); k > 0; k--) {
      const j = pick(myJobs), it = pick(j._items);
      scheduled.push({ id: sid++, userId: u.id, date: iso(day), minutes: ri(2, 12) * 15, notes: chance(0.4) ? pick(NOTES.filter(Boolean)) : null, scheduleNotes: null, itemName: it.name, jobItemId: it.id, jobId: j.id, jobNumber: j.number, jobName: j.name, isBillable: j.isBillable });
    }
  }
}

// ── job assignments (active jobs only, like the sync) ──
const assignments = [];
let aid = 30000000;
for (const j of jobs) {
  if (!['In Play', 'Paused'].includes(j.jobStatus.name)) continue;
  for (const it of j._items) {
    for (const uid of j._team.slice(0, ri(1, 2))) {
      const done = it.jobItemStatus?.name === 'Complete';
      assignments.push({ id: aid++, userId: uid, jobItemId: it.id, jobId: j.id, jobItemUserStatus: { name: done ? 'Complete' : 'In Progress' }, totalPlannedMinutes: it.totalPlannedMinutes, totalLoggedMinutes: Math.round((it.totalLoggedMinutes || 0) / 2), earliestStartDate: it.estimatedStartDate, latestEndDate: it.estimatedEndDate, ...(done ? { completedDate: it.estimatedEndDate } : {}) });
    }
  }
}

// ── quotes ──
const quotes = [];
const QS = ['Draft', 'Sent', 'Approved', 'Approved', 'Approved', 'Declined'];
for (let i = 0; i < N.quotes; i++) {
  const j = jobs[Math.floor(Math.pow(rnd(), 0.6) * jobs.length)];
  const st = pick(QS);
  const qd = addDays(j._start, -ri(0, 20));
  const ex = ri(10, 400) * 100;
  quotes.push({ id: 40000 + i, quoteNumber: 'Q-' + (1000 + i), quoteName: j.name + ' quote', jobId: j.id, jobNumber: j.number, jobName: j.name,
    company: { id: j._coId, name: j.company.name }, quoteStatus: { name: st }, totalAmountExTax: ex, totalAmountIncTax: Math.round(ex * 1.15), quoteDate: iso(qd),
    ...(st !== 'Draft' ? { sentDate: iso(addDays(qd, ri(0, 5))) } : {}), ...(st === 'Approved' ? { approvedDate: iso(addDays(qd, ri(3, 30))) } : {}), sentByUser: { id: users[0].id } });
}

// ── invoices ──
const invoices = [];
for (let i = 0; i < N.invoices; i++) {
  const j = jobs[Math.floor(Math.pow(rnd(), 0.7) * jobs.length)];
  const idate = weekday(addDays(j._end, ri(-30, 20)));
  const d = idate > today ? today : idate;
  const ageD = (today - d) / 864e5;
  const st = ageD > 60 ? (chance(0.97) ? 'Paid' : chance(0.5) ? 'Voided' : 'Awaiting Payment') : ageD > 10 ? (chance(0.6) ? 'Paid' : 'Awaiting Payment') : pick(['Draft', 'Awaiting Payment', 'Paid']);
  const ex = ri(5, 300) * 100, inc = Math.round(ex * 1.15);
  const due = addDays(d, 20);
  const paid = st === 'Paid';
  invoices.push({ id: 60000 + i, number: 'INV-' + (5000 + i), name: j.name, reference: 'Job ' + j.number, jobId: j.id, company: { id: j._coId, name: j.company.name },
    invoiceStatus: { name: st }, totalAmountExTax: ex, totalAmountIncTax: inc, amountPaidIncTax: paid ? inc : 0, balance: paid ? 0 : inc,
    invoiceDate: iso(d), ...(st !== 'Draft' ? { sentDate: iso(d) } : {}), dueDate: iso(due), ...(paid ? { paidDate: iso(addDays(d, ri(5, 40))) } : {}),
    ...(j.purchaseOrderNumber ? { purchaseOrderNumber: j.purchaseOrderNumber } : {}) });
  if (st !== 'Draft' && st !== 'Voided') {
    j.totalIssuedInvoicesExTax = (j.totalIssuedInvoicesExTax || 0) + ex;
    if (paid) j.totalPaidInvoicesExTax = (j.totalPaidInvoicesExTax || 0) + ex; else j.totalAwaitingPaymentInvoicesExTax = (j.totalAwaitingPaymentInvoicesExTax || 0) + ex;
  }
}

// ── expenses ──
const expenses = [];
for (let i = 0; i < N.expenses; i++) {
  const j = pick(timeW);
  const cost = ri(2, 200) * 10;
  expenses.push({ id: 70000 + i, jobId: j.id, jobNumber: j.number, jobName: j.name, date: iso(weekday(addDays(j._start, ri(0, 60)))), itemName: pick(['Printing', 'Stock imagery', 'Courier', 'Fonts', 'Hosting', 'Travel']), description: 'Fake expense',
    totalCost: cost, totalExTax: Math.round(cost * 1.2), loggedExpenseStatus: pick(['Draft', 'Approved', 'Invoiced']) });
}

// ── milestones ──
const milestones = [];
const live = jobs.filter((j) => j.jobStatus.name === 'In Play');
for (let i = 0; i < N.milestones; i++) { const j = pick(live); milestones.push({ id: 90000 + i, jobId: j.id, name: pick(['Launch', 'Client review', 'Print deadline', 'Go live']), date: iso(addDays(today, ri(-20, 60))) }); }

// ── job totals: planned, budgets; strip helper fields ──
for (const j of jobs) {
  j.totalPlannedMinutes = j._items.reduce((s, it) => s + (it.totalPlannedMinutes || 0), 0);
  j.totalPlannedTimeExTax = Math.round(j._items.reduce((s, it) => s + (it.totalPlannedMinutes || 0) / 60 * (it.sellRate || 0), 0));
  if (chance(0.7)) j.finalBudget = Math.round(j.totalPlannedTimeExTax * (0.9 + rnd() * 0.3) / 100) * 100;
  if (chance(0.3)) j.totalLoggedExpensesExTax = ri(1, 50) * 20;
  delete j._coId; delete j._team; delete j._items; delete j._start; delete j._end;
}

// ── write ──
fs.mkdirSync(OUT, { recursive: true });
const write = (f, data) => { const s = JSON.stringify(data); fs.writeFileSync(path.join(OUT, f), s); return s.length; };
const now = new Date().toISOString();
const files = {
  'users.json': users, 'companies.json': companies, 'contacts.json': contacts, 'jobs.json': jobs, 'logged_times.json': logged,
  'invoices.json': invoices, 'quotes.json': quotes, 'expenses.json': expenses, 'job_assignments.json': assignments,
  'milestones.json': milestones, 'scheduled_todos.json': scheduled,
};
const counts = {};
for (const [f, d] of Object.entries(files)) { const bytes = write(f, d); counts[f.replace('.json', '')] = d.length; console.log(`${f.padEnd(22)} ${String(d.length).padStart(7)} records  ${(bytes / 1048576).toFixed(2)} MB`); }
write('sync_meta.json', { last_synced: now, record_counts: counts, backfill_complete: true, detail_progress: `${jobs.length}/${jobs.length} jobs have phases+items`, errors: [], _fake: true });
write('logged_times_sweep.json', { last_complete_pass_at: now, passes_completed: 1, total: logged.length, offset: 0, _fake: true });
console.log(`\nWrote fake data to ${OUT}`);
