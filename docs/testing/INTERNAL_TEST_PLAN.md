# C&C Platform — Internal Test Plan (to 11 Dec 2026)

**Goal:** confirm the platform is reliable and usable enough for day-to-day studio work, and produce a
prioritised fix list plus a clean baseline to hand to Razor before the January backend build.

**Not in scope:** security/auth (Razor's backend), Xero, cross-user live updates, role permissions,
and a team-wide happiness report — these need a shared backend and go to Razor as specs.

---

## 1. Who and when

| Role | Tester | Focus |
|---|---|---|
| Lead / owner | Ro | Everything; triage and fixes |
| Account management | Ange, Maya | Jobs, quotes, invoices, clients, reporting — plus how they use it day/month/year (with Kelvin) |
| Studio / design | 1 designer (TBC) | To Do board, logging time, Schedule |

| Dates | Phase |
|---|---|
| 9–29 Nov | Stabilise and fix (data sync, loading, bugs, design consistency) |
| 30 Nov–4 Dec | **Round 1** — scripted scenarios below, ~30 min/day each |
| 5–8 Dec | Fix round 1 findings |
| 9–11 Dec | **Round 2** — re-test fixes + free use; sign-off |
| Before Ro's leave | Razor handover |

**Feature freeze: 1 Dec.** After that, only fixes for issues testers raise.

## 2. Before testing starts (entry criteria)

- [ ] Logged-time sync fix live; first full pass complete (To Do toolbar dot is green, "Synced Xm ago")
- [ ] October–November hours backfilled — spot-check 3 people's weeks against Streamtime
- [ ] Open bugs from the Nov audit (docs/audit/bug-audit-2026-11.md) at High severity fixed
- [ ] Testers have the live link and know how to report (section 5)

## 3. Scripted scenarios

Each tester runs their block, noting **pass / problem / idea** for every step. Compare against
Streamtime where a number is involved — the platform should match it.

### A. Everyone (≈15 min)
1. Open the platform cold. How long until the Dashboard is usable? Anything look broken?
2. Dashboard: do "Your day", the KPI hours and "Needs attention" match what you know about your week?
3. Click an 8-week sparkline — does the expanded chart make sense?
4. ⌘K search: find a job by name, by number, and a client. Try `todo Call printer 30m`.
5. Switch to dark mode (moon icon) and back. Anything unreadable?
6. Resize the window narrower/wider. Does anything wrap, overlap or disappear?

### B. Studio / designer (≈20 min)
1. To Do board: check this week's tasks match your Streamtime schedule.
2. Drag a task to another day; resize one by its edge (down to 5 min); drag the Done divider.
3. Mark a task done and log the hours. Does it move to Done and update the totals?
4. Drag a task onto the dock: next week, and hand to a teammate. Then split one across two days.
5. Press **F** for Focus mode, then Esc. Useful?
6. Open a job from a task card. Check the job plan and Progress tab against Streamtime.

### C. Account management (≈25 min)
1. Jobs list: filter by client, status and label; group by company; save a filter preset; pick columns.
2. Open a live job: check budget, hours used, invoiced and profitability against Streamtime.
3. Edit the job name, dates and status; add a phase and an item; add a milestone. Reload — still there?
4. Quotes: open a quote preview. Does the document look right to send? Create a native quote.
5. Invoices: check overdue/paid status and amounts against Streamtime; open an invoice preview.
   Tick "Uninvoiced jobs" — is the list accurate?
6. Clients: open a client — contacts, jobs and totals right? Drag a client card to create a board.
7. Reporting: pick This month / Last quarter. Do total hours, billable % and revenue match Streamtime?
8. **Day / month / year** (with Kelvin): walk through what you do daily, at month-end and at year-end.
   Note every step where you'd still need Streamtime.

## 4. What we measure

| Measure | Target |
|---|---|
| Numbers match Streamtime (hours, budgets, invoiced, revenue) | 100% of spot checks |
| Time to usable Dashboard on office wifi | < 5 s |
| Crashes / blank screens | 0 |
| High-severity issues open at sign-off | 0 |
| Testers who'd use it daily over Streamtime for their main tasks | Majority |

## 5. Reporting issues

Log each finding in the team sheet **"C&C 'Streamtime' Platform" → 📥 Feature Requests** with:
Section, what you did, what happened vs expected, a screenshot, priority (High = blocks work /
wrong numbers; Medium = annoying; Low = polish/idea), and your name + date.

Ro triages daily: **fix now / fix before handover / Razor backlog / won't do**.

## 6. Exit criteria (sign-off on 11 Dec)

- [ ] All scenario steps pass or have an accepted workaround
- [ ] Zero High issues open; Medium issues triaged with an owner
- [ ] Data spot checks match Streamtime
- [ ] Razor handover pack reviewed (docs/handover/)
- [ ] Day/month/year gaps (scenario C8) listed as Razor backlog items
