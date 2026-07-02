# C&C Platform — Roadmap

*Last updated 2 Jul 2026 · v2.28.0*

---

## Data-correctness audit (v2.20.2)

A full multi-agent audit cross-checked every consumer of Streamtime data against the **real field schemas** pulled from the live export (jobs, logged_times, invoices, quotes, expenses, users, contacts, job_assignments, scheduled_todos, milestones). The recurring bug class was code reading ST fields that don't exist or have the wrong type/nesting — which silently produces $0 / blank / wrong values instead of erroring. Ten findings fixed:

1. **Billable %** — logged_times have no top-level `isBillable` (it's on the nested `job`); all hours were counted billable. ~33% of entries are actually non-billable.
2. **Quotes screen** — `company` is a string (not object), real fields are `quoteName`/`quoteNumber`/`sentByUser`(string); `expiryDate`/`declinedDate` don't exist.
3. **Invoices** — carry `jobId`, not `jobNumber`/`jobName`; job column/filter/group resolved from the linked job.
4. **Paused filter** — `_mapStJob` collapses Paused→`inplay`; status now consults the `j.paused` flag via `jobStatusLabel()`.
5. **Per-row sell / revenue** — Progress tab and Time view re-estimated at a flat rate instead of using logged `totalExTax`.
6. **Invoice inc-GST totals** — were `exTax × 1.15`; now use real `totalAmountIncTax`/`amountPaidIncTax`.
7. **Substring job-id matches** — three more `job.includes(id)` false-match bugs ("123" in "1234").
8. **Expiring-quotes card** — removed (no expiry data in the ST export).
9. **Dead `r-job` reporting filter** — hardened (exact match).
10. **Stacking modals** — add-member and new-client modals now de-dupe.

**Confirmed clean by the audit:** budget total (`finalBudget`), expenses mapping, reallocate week-lookup, all date/hours helpers, minutes↔hours conversions, contacts/users mapping.

---

## Phase Strategy

| Phase | Status | Description |
|---|---|---|
| **Phase 1** | ✅ Live | Streamtime is source of truth. Platform reads ST data and displays everything correctly. |
| **Phase 2** | 🔄 In progress, most CRUD gaps closed (v2.21.0) | Native data creation + editing (jobs, phases, items, expenses, quotes, milestones, time). DB stub layer built — localStorage now, real API when ready. |
| **Phase 3** | ⏳ Blocked, not started | ST retired. Platform is the source of all data. `initStreamtime()` deleted, internal shape unchanged. See "What's blocking Phase 3" below. |

### What's blocking the jump to Phase 3

Phase 3 means deleting `initStreamtime()` and the ST fetch layer entirely — the platform's own writes become the only source of truth. Three things stand between here and there, in order of size:

1. **No real backend yet.** Every native write (`db*` stub functions) currently lands in an in-memory array, not durable storage — `saveData()` explicitly does NOT persist jobs/tasks to localStorage (only a couple of narrow exceptions like `cc_jobs` dedupe-migration and quotes/expenses do). A page reload loses anything created natively in that session. This is the actual size of the jump: swap every `db*` stub for a real API call, and stand up that API + database. Everything else on this list is comparatively small once that exists.
2. **Native invoice creation isn't finished.** Local creation (deposit/split invoices) shipped in v2.20.4, but there's no Xero push — that half needs real Xero API write credentials, which is a business/access task, not a coding one.
3. **@mentions + notifications need a live backend.** Not buildable on static localStorage regardless — same root blocker as #1, just a different feature surface.

Everything else — job CRUD, phase/item/expense/quote/milestone CRUD, time logging — already has a working UI and a `db*` stub ready to point at a real API. Once a backend exists, Phase 3 is mostly a search-and-replace of `db*` internals plus deleting the ST fetch/`_mapStJob` code, not a redesign.

---

## Phase 2 — Native Creation (stubs built, API-ready)

The following features are live in the UI with a localStorage stub. Swapping to a real database requires only changing the `db*` functions — all modals, validation, and render logic stays identical.

| Feature | UI | Stub | API-ready |
|---|---|---|---|
| Create job | ✅ Full modal (exists since v2.13.0) | ✅ `dbCreateJob()` | 🔄 swap for `POST /api/jobs` |
| Add phase to job | ✅ Modal from job detail | ✅ `dbCreatePhase()` | 🔄 swap for `POST /api/phases` |
| Add item to phase | ✅ Modal (name, hours, rate) | ✅ `dbCreateItem()` | 🔄 swap for `POST /api/items` |
| Add expense | ✅ Modal (job, desc, cost, sell) | ✅ `dbCreateExpense()` | 🔄 swap for `POST /api/expenses` |
| Schedule view | ✅ Team week-at-a-glance, capacity bars | — reads existing data | — |
| Global Search ⌘K | ✅ Jobs, clients, invoices, quotes | — reads existing data | — |
| Expenses list | ✅ Cross-job list, filters, search — correct cost/sell/status from ST export | — reads existing data | — |
| Reallocate logged/scheduled time | ✅ ⋮ menu on Progress tab rows, move to a different job/item | — local edit, ST is still source of truth | — |
| Create quote | ✅ Modal (Quotes list + job detail), PDF preview, merges into the same list as ST quotes | `localQuotes` + `cc_local_quotes` | 🔄 swap for `POST /api/quotes` |
| Edit job name / dates / status | ✅ Click-to-edit on job detail header (v2.21.0) | ✅ `dbUpdateJob()` — edits kept in `j._native`, re-applied after every ST re-fetch | 🔄 swap for `PATCH /api/jobs/:id` |
| Create / edit / delete milestone | ✅ Inline add + per-row edit/delete on job detail Timeline tab (v2.21.0), merges with ST milestones (tagged "ST") | ✅ `dbCreateMilestone()` / `dbUpdateMilestone()` / `dbDeleteMilestone()` | 🔄 swap for `POST/PATCH/DELETE /api/milestones` |
| Log time | ✅ Folded into mark-task-done (v2.21.0) — no separate modal, hours field appears on completion, pre-filled with planned time | ✅ `dbCreateTimeEntry()` (previously unused, now wired up) | 🔄 swap for `POST /api/time-entries` |

**Removed in v2.20.1:** the old standalone Log Time modal (Todo bar + job detail), Plan My Week, and My Items panel — all were redundant with the existing Add Task flow and added confusion. Time logging itself came back in v2.21.0, folded into the mark-task-done moment instead of a separate modal.

**Bug fixes in v2.20.1 worth noting for Phase 2 planning:**
- Jobs with a `dueDate` set crashed the entire job detail view (missing `fmtDate` global — was only ever defined as a local helper in two unrelated render functions). Affected an unknown number of jobs across the dataset, not just one.
- Jobs list budget total was reading `totalPlannedTimeExTax` before `finalBudget` — Streamtime's own total is driven by `finalBudget`. Worth double-checking other places in the codebase that read job financial fields for the same wrong-priority mistake.
- Expenses list was reading field names that don't exist in the ST export (`costTotal`, `sellTotal`, `name`, and treating `loggedExpenseStatus` as an object when it's a plain string) — silently produced $0/Draft for every row instead of erroring, which is why it went unnoticed.

### Phase 2 still to build
| Feature | Notes |
|---|---|
| Xero push for natively-created invoices | The local creation half (deposit/split invoices) shipped v2.20.4; the Xero push half needs real Xero API write credentials — a business/access task, not a coding one |
| @mentions + notifications | Needs a real-time backend (websockets/polling server) — not buildable on the static localStorage architecture |
| Real durable backend for all `db*` writes | The actual size of the Phase 2→3 jump — see "What's blocking Phase 3" above. Every other Phase 2 feature is UI-complete and just needs its stub swapped once this exists |

**Shipped (v2.28.0):** Progress+Profitability merged into one job-detail view, combined start→due dates pill with two-field popover, 5-minute todo resize floor (was 15m), focus-ring fix on text fields, brief textarea padding, letter-spacing modernisation, task-card surface polish.

**Shipped (v2.27.0):** Modern type system (Playfair/DM Sans → Inter; weight-based hierarchy, tabular numerals), global control system (custom-chevron selects, unified focus rings), searchable job picker with recents in the add-task modal.

**Shipped (v2.26.0):** Hover-expanding sidebar rail (72px icons → 216px labelled overlay), unified 26px serif-italic view-title system across Reporting/Time/Deadlines/Boards/Settings, Settings redesign (serif section titles, surface-system cards, pill nav, page-level scrolling with the scrollbar at the window edge).

**Shipped (v2.25.0):** Design overhaul — labelled sidebar navigation (was a 68px icon strip), surface system (rounded cards + layered shadows + warmer paper palette), confident serif type scale, rounded controls, warm scrollbars, view-switch transitions, blurred modal backdrops. CSS-layer only; no layout logic touched.

**Shipped (v2.24.0):** Full refinement pass — 5 data-loss fixes (native jobs deleted by sync, archive/star reverting, deleted ST jobs resurrecting, overlay loss on partial sync, native-time double-count), double-commit fix on header edits, honest cost-estimate flag, `esc()` escaping at the top innerHTML sites, and a design-system tidy-up (one button spec, one pill shape, unified tab styling, semantic colour tokens, focus-visible, spinner, 5 duplicate CSS blocks removed).

**Shipped (v2.23.0):** Per-task done sync on the Todo board (was per-day), Profitability tab on job detail (revenue vs cost vs margin), Deadline-risk dashboard card, single consolidated job-status control + aligned date pills, cross-tab live sync, Global Search now covers invoices + quotes, wrong-job task-picker fix, `.modal-save` styling.

**Phase 3 pre-flight (from the v2.24.0 code review):** a compact inventory of every ST read (9 globals: jobs via `_mapStJob`, stLoggedTimes, stScheduledTodos, stJobAssignments, stExpenses, stInvoices, stQuotes, stMilestones, stContacts/companies, stUsersById) and every mutation path a backend must cover (db* stubs; direct paths: quote status cycle, split invoices, client edits `saveClientsData`, people `savePeople`, labels, boards, settings, starred, filters) is recorded in the review notes. ~20 dead functions identified for deletion during the migration (e.g. `_trackRecent`, `addTeamMember`, `goToWeek`, `openInvoiceForJob`, `exportReportingCSV`).

**Shipped (v2.22.0):** Durable native data — all native creates/edits survive reload and the Streamtime sync (was in-memory only).

**Shipped (v2.21.0):** Inline job name/date/status editing, native milestone CRUD, time logging folded into mark-task-done.

**Deferred (deliberately, with rationale):**
- **Column picker** on Jobs/Invoices/Quotes tables — those tables render hardcoded `th`/`td` HTML; a show/hide/reorder picker needs all three restructured into column-definition arrays first. Own focused pass (don't rush a refactor of the core tables).
- **Role/admin permission gate** — a client-side-only gate is bypassable without real auth; belongs with the Phase 3 backend.
- **ST-field accessor refactor** — best done *during* the Phase 3 migration (when those ~20 read sites change anyway) rather than as speculative churn now.

**Shipped (v2.20.5):** Job timeline (custom HTML/CSS Gantt-style view using the phase date ranges shipped in v2.20.4 — no external Gantt library needed), Starred items panel (sidebar icon + dedicated panel; merges the existing per-job `j.starred` flag with a new generic star store usable on clients/quotes/invoices), Create quote natively (modal + PDF preview, merges into the same Quotes list/detail/print code paths as Streamtime quotes via `localQuotes`).

---

## What's Live (v2.16.0+)

### Data mapped from Streamtime
| Field | Source | Status |
|---|---|---|
| `purchaseOrderNumber` | jobs.json | ✅ Mapped → job detail, jobs table, invoice table, PO filter |
| `startDate` / `dueDate` (job) | jobs.json | ✅ Mapped → job detail meta, dashboard deadlines, Deadlines calendar |
| `description` (job brief) | jobs.json | ✅ Mapped → job detail |
| `totalAmountExTax` (quote) | quotes.json | ✅ Mapped → Quotes list value column |
| `quoteStatus.name` | quotes.json | ✅ Mapped → real Approved/Declined/Sent/Draft pills |
| `approvedDate` / `declinedDate` | quotes.json | ✅ Mapped → quote detail expanded row |
| `expiryDate` (quote) | quotes.json | ✅ Mapped → dashboard "Quotes expiring soon" alert |
| `dueDate` (invoice) | invoices.json | ✅ Mapped → All Invoices table + overdue badge |
| `paidDate` (invoice) | invoices.json | ✅ Mapped → All Invoices table + DSO metric |
| `totalAmountIncTax` (invoice) | invoices.json | ✅ Mapped → All Invoices amount column |
| `costRate` (user) | users.json | ✅ Mapped into stUsersById |
| `billableRate` (user) | users.json | ✅ Mapped into stUsersById |
| `hoursWorkedMon–Fri` (user) | users.json | ✅ Mapped → ST capacity target |
| `position` / `title` (contact) | contacts.json | ✅ Mapped → client detail contact cards |
| `website` (company) | companies.json | ✅ Mapped → client detail clickable link |
| `address` (company) | companies.json | ✅ Mapped → client detail + invoice print template |
| `expenses` | expenses.json | ✅ Syncing, shown in job detail Expenses tab |
| `job_assignments` | job_assignments.json | ✅ Planned assignments appear in todo zone |
| `milestones` | milestones.json | ✅ Shown on job detail |

### Features shipped
| # | Feature | Location | Version |
|---|---|---|---|
| QW1 | Quote value column + real status (Approved/Declined/Sent/Draft) | Jobs → Quotes | v2.9.5 |
| QW2 | Invoice due date column + overdue badge | Jobs → Invoices | v2.9.5 |
| QW3 | Job start date + due date in job detail meta line | Jobs | v2.9.5 |
| QW4 | Company website link on client detail | Jobs → Clients | v2.9.5 |
| QW5 | Quote expiry alert on Dashboard | Dashboard | v2.16.0 |
| QW6 | ST capacity per person replaces hardcoded 30h target | Todo / Reporting | v2.9.7 |
| QW7 | Invoice paid date column | Jobs → Invoices | v2.9.7 |
| QW8 / #19 | PO number on job detail, jobs table, invoice table, PO filter | Jobs / Invoices | v2.15.0 |
| M3 / #10 | Deadline month-view calendar | Jobs → Deadlines tab | v2.15.0 |
| M4 / #11 | "Needs attention" smart filter in Jobs list | Jobs | v2.13.0 |
| M5 / #12 | Per-client revenue trend | Reporting → Clients | v2.13.0 |
| M6 / #13 | Utilisation report | Reporting → People | v2.13.0 |
| M7 / #14 | Contact management — add/edit/delete per client | Jobs → Clients | v2.15.0 |
| L1 / #15 | Staff profitability & utilisation (revenue vs cost) | Reporting | v2.13.0 |
| L3 / #17 | Quote-to-invoice pipeline funnel | Reporting → Business | v2.14.0 |
| P5 / #20 | Workspace export / import | Settings | v2.14.0 |
| P1 | Monday rollover prompt — unfinished tasks from last week | Todo | v2.15.0 |
| P2 | Uninvoiced work report | Reporting → Business | v2.16.0 |
| P3 | Studio board preset — auto-board by workflow stage | Boards | v2.16.0 |
| P4 | Date-range picker in Reporting | Reporting | v2.16.0 |
| P6 | Capacity warning — day header tints when full | Todo | v2.16.0 |
| P7 | Working hours + rate per person in Settings | Settings | v2.15.0 |
| P8 | Quiet-client flag — no active job in N weeks → dashboard nudge | Dashboard | v2.14.0 |
| F1 | Invoice status filter in All Invoices | Jobs → Invoices | v2.16.0 |
| F3 | Smart stackable filter chips + saved presets for Quotes | Jobs → Quotes | v2.17.0 |
| F4 | Smart stackable filter chips + saved presets for Invoices | Jobs → Invoices | v2.17.0 |
| F5 | Group By (Status / Company / Job) on Quotes and Invoices | Jobs → Quotes / Invoices | v2.17.0 |
| F6 | Job number shown on quote cards + in invoice table | Jobs → Quotes / Invoices | v2.17.0 |
| F7 | $150/h default cost rate when ST returns 0 | Reporting / Profitability | v2.17.0 |
| F8 | Jobs: chip filter system (replaces dropdowns) + group by | Jobs list | v2.18.0 |
| F9 | Client grouping — master client header in clients list | Jobs → Clients | v2.18.0 |
| F10 | Quote + invoice detail slide-out drawer | Jobs → Quotes / Invoices | v2.18.0 |
| F11 | ST quotes shown on job detail Quote tab (multiple per job) | Jobs → Quote tab | v2.18.0 |
| F12 | Activity tab timeline redesign | Jobs → Activity | v2.18.0 |
| F13 | Studio board fixed — live job cards instead of note cards | Boards | v2.18.0 |
| F14 | Default cost rate + payment terms in Settings → Workspace Defaults | Settings | v2.18.0 |
| F15 | Log Time — native time entry modal from Todo + job detail | Todo / Jobs | v2.20.0 |
| F16 | Schedule view — team week-at-a-glance with capacity bars | Schedule (new nav) | v2.20.0 |
| F17 | Global Search ⌘K — cross-entity search (jobs/clients/invoices/quotes) | Global | v2.20.0 |
| F18 | Expenses list — cross-job view with filters, search, cost/sell totals | Jobs → Expenses | v2.20.0 |
| F19 | My Items panel — all job items assigned to current user | Todo | v2.20.0 |
| F20 | Plan My Week — auto-distribute items across Mon–Fri by capacity | Todo | v2.20.0 |
| F21 | Add Phase + Add Item — native creation on job detail | Jobs → Job Plan | v2.20.0 |
| F22 | Add Expense — modal from Expenses tab | Jobs → Expenses | v2.20.0 |
| F23 | DB stub layer — all create functions API-ready (`db*` pattern) | Architecture | v2.20.0 |
| 0a | Dashboard block toggles in Settings | Settings | v2.14.0 |
| 0e | Jobs — more filter options (health, workflow, label, PO) | Jobs | v2.14.0 |
| 0f | Clients — search + stats | Jobs → Clients | v2.14.0 |
| 0g / QW4 | Company website + editable client fields | Jobs → Clients | v2.14.0 |
| — | Company address on client detail + invoice print | Jobs → Clients / Print | v2.16.0 |
| — | DSO (Days Sales Outstanding) metric | Jobs → Invoices | v2.16.0 |
| — | Per-person hoursPerDay drives capacity bar | Todo | v2.16.0 |

---

## Still Open

### Blocked — data not in ST sync
| Item | Blocker | Notes |
|---|---|---|
| **Time approval workflow** (#9 / M2) | `approved` / `approvedAt` not in logged_times.json sync | Would need Streamtime export to include these fields |
| **Profitability margin** (#8 / M1) | `costRate` is 0 for 36/37 users in ST | Data quality issue in ST, not a code problem |

### Deferred — infra or library required
| Item | Blocker | Notes |
|---|---|---|
| **ST write-back** (#18 / L4) | Needs serverless proxy + ST API write credentials | Vercel Edge Function + ST API key required |

### Shipped (v2.20.4)
**Gantt view** (#16 / L2) shipped in v2.20.5 — turned out not to need an external library; phase-level granularity rendered fine as a custom HTML/CSS timeline once phase date ranges existed (v2.20.4).

| # | Feature | Location | Notes |
|---|---|---|---|
| F2 | Detailed expense input — track individual purchases, show over/under | Jobs → Expenses | Already built (`_expSubs` etc.) — roadmap just hadn't been updated |
| — | Quote versioning (v1/v2 revisions) | Jobs → Quotes (drawer) | Local-only version history; "Revise quote" saves a new value+note without touching the ST record |
| — | Deposit / split invoicing | Jobs → Invoice modal | Add named partial invoices (% or $) against a job's total, each with its own status + print |
| — | Contact job title shown on invoice print | Quote/Invoice print preview | `_mapStCompany` now carries `contactTitle`; shown under the contact name on both templates |
| — | Phase date ranges mapped + shown on job detail | Jobs → Job Plan | `_mapStJob` now derives phase start/due from item `estimatedStartDate`/`estimatedEndDate`; shown as a calendar chip on the phase header |

### Blocked — Streamtime export genuinely lacks these fields
| Item | Blocker | Notes |
|---|---|---|
| `leaveBalance` from users.json | Field not present in the live `users.json` export | Confirmed by direct check of the export, not just code — would need ST to add it |
| Invoice / quote `lineItems[]` from ST | Field not present in `invoices.json` or `quotes.json` | Line-item breakdowns are currently reconstructed from the linked job's plan instead |
| `startTime` / `endTime` from logged_times.json | Field not present in the live export (only `date`, `completedDatetime`) | Blocks a true timesheet/clock-in view |

---

## Data Gaps Remaining in Sync

| Field | Source | Priority | Notes |
|---|---|---|---|
| `approved` / `approvedAt` | logged_times.json | High | Time approval workflow |
| `lineItems[]` | invoices.json | Medium | ST invoice line detail |
| `lineItems[]` | quotes.json | Low | ST quote line detail |
| `startTime` / `endTime` | logged_times.json | Low | Timesheet view |
| `leaveBalance` | users.json | Low | Capacity planning |

---

## Architecture Notes

- **Single file** `index.html` — vanilla JS, localStorage, no build step
- **Data source** — 7 JSON files fetched from GitHub CDN (`streamtime-data` branch), refreshed hourly
- **Deploy** — push to `main` → Vercel auto-deploys in ~30s
- **Persistence** — localStorage only; workspace export/import added in v2.14.0 for backup
- **Write-back** — DB stub layer added v2.20.0; `db*` functions use localStorage now, swap `fetch('/api/...')` for Phase 2 backend
- **Phase 2 backend** — when ready: Vercel Edge Functions or similar, one endpoint per entity (jobs/time/phases/items/expenses)

---

## Machine-readable index (parsed by generate_meta.py → roadmap.json → Google Sheet)

*Do not rename these headers or item format — the sync script depends on them.*

### Quick Wins (1–2 days each)

**QW1. Quote value column and real status from ST**
**QW2. Invoice due date column and overdue badge in All Invoices table**
**QW3. Job start date and due date in job detail meta line and Dashboard deadline alerts**
**QW4. Company website link on client detail card**
**QW5. Quote expiry alert on Dashboard**
**QW6. ST capacity per person replaces hardcoded 30h week target**
**QW7. Invoice paid date column and Days Sales Outstanding metric**
**QW8. Purchase order number on job detail and invoice table**
**P1. Monday rollover prompt — move unfinished tasks from last week**
**P3. Studio board preset — auto-board of all live jobs by workflow stage**
**P4. Date-range picker in Reporting**
**P5. Workspace export/import — one JSON file data backup**
**P6. Capacity warnings while booking — tint day header when full**
**P7. Working hours per person in Settings**
**P8. Quiet-client flag — no active job in N weeks nudge**
**F1. Better filtering on Invoices**
**0a. Dashboard customisation section in Settings**
**0e. Jobs — more filter options**
**0f. Clients — more filters and stats**
**0g. Clients — add and edit UI for company fields**

### Medium (3–5 days each)

**M1. Profitability per job — staff cost vs revenue vs expenses**
**M2. Time approval workflow — surface unapproved entries and alert on Dashboard**
**M3. Job due-date calendar and deadline view**
**M4. Needs attention smart filter in Jobs list**
**M5. Per-client revenue trend month-by-month in Reporting Clients**
**M6. Utilisation report — billable percentage vs capacity per person per week**
**M7. Contact management — add and edit contacts per client**
**P2. Uninvoiced work report — approved quotes plus time minus invoiced**
**F2. Detailed expense input against budget — track individual purchases**

### Large (1+ week each)

**L1. Staff profitability and utilisation dashboard — P&L view**
**L2. Job timeline Gantt view**
**L3. Quote-to-invoice pipeline funnel**
**L4. ST write-back — log time directly from platform to Streamtime**
**L5. Purchase order tracking — PO filter and print on invoice**
