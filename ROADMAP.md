# C&C Platform — Roadmap to best-in-class

*Written 12 Jun 2026 at v2.2.0. Section-by-section state of play, then the push list.*

The platform's job is twofold: a **rich visual read on the whole business** (where the money and hours are going) and a **daily booking/timesheet tool** each person actually enjoys using. Every idea below is judged against those two.

---

## Section reports

### Dashboard — solid core, one-way glass
**Today:** KPI strip, Your Day, team cards grouped by team (respecting your profile preference), over-budget alerts. All live.
**Gaps:** It reports but doesn't let you act — you can't tick a task done from Your Day, and the urgent count has nowhere to click through to.
**Push:**
- Tick/edit tasks directly from Your Day.
- Make every KPI clickable (billable % → reporting filtered to this week; urgent count → a filtered task list).
- A "this week for the studio" money line: sell value logged this week vs. weekly target — the single number an owner wants at 8am.
- Monday morning view: who's overloaded / underloaded this week at a glance (capacity heat strip per person).

### Todo / Schedule — the daily driver, nearly there
**Today:** Week list with proportional time blocks, edge-resize, live divider scaling, drag between days, done drawer, calendar view with resize/duplicate, repeat tasks, reassignment, person switcher.
**Gaps:** No multi-week visibility (next week exists only via arrows); no overdue concept — an unfinished Tuesday task just sits there as the week ages.
**Push:**
- **Rollover prompt:** Monday open → "You have 4 unfinished tasks from last week — move them to this week?" One click. This is the single biggest timesheet-hygiene win.
- Capacity warnings while booking: adding a 3h task to a day already at 7h tints the day header.
- Week templates ("typical WIP week") to stamp recurring structure.
- Keyboard-first add: N opens the modal (done) — next, a quick-add row at the top of each day (type title, enter, done).

### Jobs list — good bones, needs financial glance
**Today:** Search, filters, bulk actions, archived handling, live budget/hours bars, labels.
**Push:**
- Sort by any column (esp. budget % and hours %) — find the bleeding job in one click.
- A "needs attention" smart filter: over 80% budget, no invoice, quote unanswered > 7 days.
- Inline workflow advance from the list (the badge is already clickable in detail).

### Job plan — the heart; make items first-class
**Today:** Phases/items with logged-vs-planned, live sell-used, Progress tab with per-person time table and reallocation, quote, invoice, activity.
**Gaps:** Item ids vs names is now robust, but items still carry no state beyond open/complete; no way to see "remaining" budget per item at a glance.
**Push:**
- Per-item progress bar (logged/planned) directly in the row — colour shifts as it burns.
- "Remaining" column toggle (planned − logged) — what's left to spend, the producer's question.
- Phase-level rollups in the phase header (logged/planned per phase, not just sell).
- Progress tab: date-range filter + CSV export (it's the timesheet audit view — it'll be asked for at invoice time).
- Budget snapshot at quote-approval: freeze approved numbers so scope-creep is measurable against them.

### Quotes & invoices — print works; lifecycle next
**Today:** Branded documents (real logo), print/PDF, status cycling, Xero CSV, GST, T&Cs, display options.
**Push:**
- Quote versioning: revise after client feedback without losing v1 (v1, v2 with a diff of totals).
- Deposit / split invoicing: invoice 50% on approval, balance on delivery — very common agency pattern.
- "Uninvoiced work" report: approved quotes + logged time minus what's been invoiced = the money you've earned but not asked for. Likely the highest-value single number in the whole product.
- Payment terms and due-date tracking with an overdue flag in the invoices list.

### Priority boards — fixed; now decide what they're for
**Today:** Custom kanban (now properly isolated), client boards, people boards, all deletes working.
**Push:**
- Card → job-plan deep links on every card type (job cards have it; client/person cards should too).
- A "Studio board" preset: one auto-board of all live jobs by workflow stage — the agency wall, zero setup.
- WIP limits per column (soft warning when a column exceeds N cards).

### Reporting — charts exist; answers don't (yet)
**Today:** Hours by person/day/job, budget vs actuals, CSV + Xero export, team filters.
**Push:**
- Utilisation report: billable % per person per week against a target — the number agencies actually manage by.
- Client profitability: hours × rate vs. quoted, by client, over a period. Ranks your best and worst clients.
- Date-range picker (not just relative periods) — month-end reporting needs "1–31 May".
- Save a filter set as a named report ("Monthly client report") — one click each month.

### Clients — directory today, relationship record tomorrow
**Push:**
- Client-level financial summary: lifetime billed, active quote value, average margin (data already exists job-side).
- Quiet-client flag: no active job in N weeks → surfaces on the dashboard as a nudge.

### Settings — workspace vs profile split has begun
**Push:**
- Per-person default rate (feeds new items and utilisation reports).
- Working days / hours per person (the `days` field exists; the day-cap is hardcoded at 8h).
- Workspace-level: company details for documents (address/GST currently hardcoded in two templates), invoice numbering prefix, default markup %.

---

## Cross-cutting (the platform-level pushes)

1. **Undo.** Deletes are confirmed but final. A 10-second "Deleted — Undo" toast for tasks, items, phases, boards and jobs would remove the last bit of fear from daily use. Cheap to build (keep the spliced object + index).
2. **Notifications surface.** The bell: urgent tasks, over-budget jobs, quotes pending > 7 days, invoices overdue. One feed, click-through to the thing. (Needs a half-day of UX thought first — what's *worth* interrupting for.)
3. **Data safety.** Everything lives in one browser's localStorage. Before this becomes the system of record: Settings → "Export workspace" (one JSON file) and "Import workspace". An hour's work, existential insurance. Longer term, a tiny sync backend (even a single JSON blob on S3/KV with a shared key) gets the team one source of truth — currently each person's browser is its own island, which will bite the moment two people book time.
4. **Multi-user reality check.** Related to #3: today "assign to Bianca" only means anything on *your* machine. Decide early whether v3 is "everyone uses one shared deployment with sync" or "per-person with nightly export merge" — it changes several designs (ids are already collision-proof, which helps).
5. **The 10k-line ceiling.** v2.2 bought ~700 lines back. The single-file constraint still holds, but when the time comes: split to `app.js`/`app.css` needs only a trivial Vercel static config.

## Suggested order

**Fixed since this was written (v2.3.0):** searchable client/item dropdowns, drop-at-indicator reordering, live divider gating, live calendar reflow on resize, repeat-on-edit, repeat icons, delete button placement, board card dedupe + live-view labelling.

| Phase | Items | Why first |
|---|---|---|
| Next | Undo toasts · rollover prompt · workspace export/import | Daily-use trust + data safety, all cheap |
| Then | Uninvoiced-work report · per-item progress bars · utilisation report | The money answers |
| Then | Notifications bell · quote versioning · deposit invoicing | Workflow depth |
| Later | Sync backend · client profitability · saved reports | Multi-user era |
