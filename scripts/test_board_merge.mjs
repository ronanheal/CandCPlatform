// Tests for bvMergeBoard (Boards → Import → "Merge into existing board").
// The function lives in index.html (<script id="boards-merge-script">); this extracts that block
// and runs the real code. Run: node scripts/test_board_merge.mjs   (fixtures are made up)

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = html.match(/<script id="boards-merge-script">([\s\S]*?)<\/script>/);
assert.ok(m, 'boards-merge-script block not found in index.html');
const sandbox = { module: { exports: {} } };
vm.runInNewContext(m[1], sandbox);
const { bvMergeBoard, bvMergeSummary } = sandbox.module.exports;

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n       ')); }
}

// Made-up team directory standing in for `people`.
const PEOPLE = {
  p_ada: { name: 'Ada Lovelace', email: 'ada@example.test', role: 'Designer' },
  p_alan: { name: 'Alan Turing', email: 'alan@example.test' },
  p_grace: { name: 'Grace Hopper', email: '' },
};
let n = 0;
const H = () => ({
  now: 1700000000000,
  uid: (p) => `${p}_${++n}`,
  newCard: (x) => ({ id: `k_${++n}`, type: 'card', title: '', desc: '', checklist: [], ...x }),
  newCol: (name, color) => ({ id: `c_${++n}`, name, color: color || 'grey', cards: [] }),
  clientCard: (name, x) => ({ id: `k_${++n}`, type: 'client', clientRef: name, desc: '', ...(x || {}) }),
  findPerson: (c) => {
    if (c.personRef && PEOPLE[c.personRef]) return c.personRef;
    const em = String(c.email || '').toLowerCase();
    if (em) { const k = Object.keys(PEOPLE).find((k) => PEOPLE[k].email === em); if (k) return k; }
    const nm = String(c.title || '').toLowerCase();
    return Object.keys(PEOPLE).find((k) => PEOPLE[k].name.toLowerCase() === nm) || null;
  },
  personName: (c) => (c.personRef && PEOPLE[c.personRef] ? PEOPLE[c.personRef].name : c.title || ''),
  personEmail: (c) => (c.personRef && PEOPLE[c.personRef] ? PEOPLE[c.personRef].email : ''),
});

// Like the Team WIP template: a person card per team member + months with an empty checklist.
function teamWip() {
  return {
    id: 'b1', type: 'custom', template: 'wip-team', name: 'Team WIP', updatedAt: 1,
    columns: [
      { id: 'c1', name: 'Performance', cards: [
        { id: 'k1', type: 'person', personRef: 'p_ada', desc: '' },
        { id: 'k2', type: 'person', personRef: 'p_alan', desc: '3 Mar · existing line' },
        { id: 'k3', type: 'person', personRef: 'p_grace', desc: '' },
      ] },
      { id: 'c2', name: 'Performance actions', cards: [
        { id: 'k4', kind: 'note', title: 'November 2026', checklists: [{ id: 'l1', title: 'People actions', items: [] }] },
        { id: 'k5', kind: 'note', title: 'December 2026', checklists: [{ id: 'l2', title: 'People actions', items: [{ id: 'i0', text: 'Book reviews', done: false }] }] },
      ] },
    ],
  };
}
function notesFile() {
  return {
    name: 'Team WIP', visibility: 'admins',
    columns: [
      { name: 'performance', cards: [
        { type: 'person', title: 'Ada', role: 'Lead designer', email: 'ada@example.test', desc: '1 Feb · started\n\n2 Feb · check-in' },
        { type: 'person', title: 'alan turing', desc: '3 Mar · existing line\n4 Mar · new line', role: 'Engineer' },
        { type: 'person', title: 'Grace', email: 'grace@example.test', desc: '5 Apr · note' },
        { type: 'person', title: 'New Starter', role: 'Intern', desc: '6 May · welcome' },
      ] },
      { name: 'Performance Actions', cards: [
        { type: 'card', title: 'November', checklist: [{ text: 'One', done: false }, { text: 'Two', done: true }] },
        { type: 'card', title: 'december', checklist: [{ text: 'Book reviews' }, 'Plan party'] },
        { type: 'card', title: 'January', checklist: ['Kick-off'] },
      ] },
      { name: 'Clients', cards: [
        { type: 'client', clientName: 'Example Co' },
        { type: 'client', clientName: 'Example Co' },
        { type: 'job', jobNumber: '123' },
      ] },
    ],
  };
}
const card = (b, id) => b.columns.flatMap((c) => c.cards).find((k) => k.id === id);

t('people: matched by email/name/first name; notes appended, duplicates skipped', () => {
  const b = teamWip(); const r = bvMergeBoard(b, notesFile(), H());
  assert.equal(card(b, 'k1').desc, '1 Feb · started\n\n2 Feb · check-in');
  assert.equal(card(b, 'k2').desc, '3 Mar · existing line\n4 Mar · new line');
  assert.equal(card(b, 'k3').desc, '5 Apr · note');
  assert.equal(r.notes, 5);       // 2 (Ada) + 1 (Alan) + 1 (Grace) + 1 (new person)
  assert.equal(r.people, 4);
  assert.equal(r.peopleAdded, 1);
  assert.equal(b.columns[0].cards.length, 4);
  const nw = b.columns[0].cards[3];
  assert.equal(nw.type, 'person'); assert.equal(nw.title, 'New Starter'); assert.equal(nw.role, 'Intern');
});

t('people: role and email filled only when empty', () => {
  const b = teamWip(); card(b, 'k2').role = 'Keep me';
  bvMergeBoard(b, notesFile(), H());
  assert.equal(card(b, 'k1').role, 'Lead designer');   // was empty on the card
  assert.equal(card(b, 'k1').email, undefined);        // record already has an email
  assert.equal(card(b, 'k2').role, 'Keep me');
  assert.equal(card(b, 'k3').email, 'grace@example.test');
});

t('people: matched by personRef first', () => {
  const b = teamWip();
  const r = bvMergeBoard(b, { columns: [{ name: 'Performance', cards: [{ type: 'person', personRef: 'p_alan', title: 'Someone Else', desc: 'x' }] }] }, H());
  assert.equal(card(b, 'k2').desc.endsWith('\nx'), true); assert.equal(r.peopleAdded, 0);
});

t('notes: month prefix match, empty placeholder checklist filled, duplicates skipped', () => {
  const b = teamWip(); const r = bvMergeBoard(b, notesFile(), H());
  const nov = card(b, 'k4'), dec = card(b, 'k5');
  assert.equal(nov.checklists.length, 1);
  assert.equal(nov.checklists[0].title, 'People actions');
  assert.deepEqual(nov.checklists[0].items.map((i) => [i.text, i.done]), [['One', false], ['Two', true]]);
  assert.equal(nov.checklist.length, 2);               // flat copy kept in step
  assert.deepEqual(dec.checklists[0].items.map((i) => i.text), ['Book reviews', 'Plan party']);
  const jan = b.columns[1].cards.find((k) => k.title === 'January');
  assert.ok(jan); assert.equal(jan.checklists[0].items.length, 1);
  assert.equal(r.items, 2 + 1 + 1); assert.equal(r.noteCards, 1);
});

t('columns: matched case-insensitively, missing ones appended', () => {
  const b = teamWip(); const r = bvMergeBoard(b, notesFile(), H());
  assert.deepEqual(b.columns.map((c) => c.name), ['Performance', 'Performance actions', 'Clients']);
  assert.equal(r.columns, 1);
});

t('clients and jobs: duplicates skipped', () => {
  const b = teamWip(); const r = bvMergeBoard(b, notesFile(), H());
  assert.equal(r.clients, 1); assert.equal(r.jobs, 1);
  assert.equal(b.columns[2].cards.length, 2);
  b.columns[0].cards.push({ id: 'kx', kind: 'job', jobRef: '999' });
  const r2 = bvMergeBoard(b, { columns: [{ name: 'Other', cards: [{ type: 'job', jobNumber: '999' }, { type: 'client', clientName: 'example co' }] }] }, H());
  assert.equal(r2.jobs, 0); assert.equal(r2.clients, 0);
});

t('idempotent: the same file twice adds nothing the second time', () => {
  const b = teamWip(); bvMergeBoard(b, notesFile(), H());
  const before = JSON.stringify(b);
  const r = bvMergeBoard(b, notesFile(), H());
  assert.equal(r.changed, 0); assert.equal(r.notes, 0); assert.equal(r.items, 0);
  assert.equal(r.peopleAdded + r.noteCards + r.clients + r.jobs + r.columns, 0);
  assert.equal(JSON.stringify(b), before);
  assert.match(bvMergeSummary(r), /^Nothing new/);
});

t('preview on a clone leaves the board untouched; summary reads well', () => {
  const b = teamWip(); const before = JSON.stringify(b);
  const r = bvMergeBoard(JSON.parse(before), notesFile(), H());
  assert.equal(JSON.stringify(b), before);
  assert.equal(bvMergeSummary(r), 'Will add 5 notes to 4 people, 4 checklist items, 1 new person, 1 new note card, 1 client, 1 job, 1 new list, 3 empty roles/emails filled');
});

t('flat checklist on the existing card is reused, not duplicated', () => {
  const b = { columns: [{ name: 'A', cards: [{ id: 'q', kind: 'note', title: 'Todo', checklist: [{ id: 'z', text: 'a', done: false }] }] }] };
  const r = bvMergeBoard(b, { columns: [{ name: 'a', cards: [{ title: 'TODO', checklist: ['a', 'b'] }] }] }, H());
  const c = b.columns[0].cards[0];
  assert.equal(r.items, 1); assert.equal(c.checklists.length, 1);
  assert.deepEqual([...c.checklist.map((i) => i.text)], ['a', 'b']);
});

t('bad input is skipped, not thrown', () => {
  const b = teamWip();
  const r = bvMergeBoard(b, { columns: [null, 'x', { name: 'Performance', cards: [null, [], 'y', { type: 'person' }] }] }, H());
  assert.equal(r.notes, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
