# C&C Platform — Roadmap

*Last updated 19 Jun 2026 · v2.20.2*

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
| **Phase 2** | 🔄 In progress | Native data creation (jobs, time, expenses, quotes, invoices). DB stub layer built — localStorage now, real API when ready. |
| **Phase 3** | ⏳ Future | ST retired. Platform is the source of all data. `initStreamtime()` deleted, internal shape unchanged. |

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

**Removed in v2.20.1:** Log Time modal (Todo bar + job detail), Plan My Week, and My Items panel — all were redundant with the existing Add Task flow and added confusion. `dbCreateTimeEntry()` stays in the codebase as the API-ready stub for when native time logging is built properly later.

**Bug fixes in v2.20.1 worth noting for Phase 2 planning:**
- Jobs with a `dueDate` set crashed the entire job detail view (missing `fmtDate` global — was only ever defined as a local helper in two unrelated render functions). Affected an unknown number of jobs across the dataset, not just one.
- Jobs list budget total was reading `totalPlannedTimeExTax` before `finalBudget` — Streamtime's own total is driven by `finalBudget`. Worth double-checking other places in the codebase that read job financial fields for the same wrong-priority mistake.
- Expenses list was reading field names that don't exist in the ST export (`costTotal`, `sellTotal`, `name`, and treating `loggedExpenseStatus` as an object when it's a plain string) — silently produced $0/Draft for every row instead of erroring, which is why it went unnoticed.

### Phase 2 still to build
| Feature | Notes |
|---|---|
| Create quote natively | Modal + PDF preview |
| Create invoice natively | Modal + Xero push |
| Job timeline / Gantt | Needs phase date ranges from ST first |
| @mentions + notifications | Needs real-time backend |
| Starred items persistent panel | Exists in localStorage, needs panel UI |

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
| #15 | Staff profitability & utilisation (revenue vs cost) | Reporting | v2.13.0 |
| #17 | Quote-to-invoice pipeline funnel | Reporting → Business | v2.14.0 |
| #20 | Workspace export / import | Settings | v2.14.0 |
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
| **Gantt view** (#16 / L2) | Phase date ranges not in sync; needs SVG timeline lib | frappe-gantt or custom SVG; phase dates need mapping first |
| **ST write-back** (#18 / L4) | Needs serverless proxy + ST API write credentials | Vercel Edge Function + ST API key required |

### Outstanding — feasible, not yet built
| # | Feature | Location | Notes |
|---|---|---|---|
| F2 | Detailed expense input — track individual purchases, show over/under | Jobs → Expenses | Line items within expense budget |
| — | Quote versioning (v1/v2 revisions) | Jobs → Quotes | Revise without losing prior version |
| — | Deposit / split invoicing (50% on approval) | Jobs → Invoices | Partial invoice workflow |
| — | Contact job title shown on invoice print | Print | `position` mapped, not on print template |
| — | `leaveBalance` from users.json | Dashboard / Team | Show leave balance on team cards |
| — | Phase date ranges mapped + shown on job detail | Jobs | Enables Gantt; phase dates in jobs.json |
| — | Invoice `lineItems[]` from ST | Jobs → Invoices | Show ST invoice lines in invoice detail |
| — | `startTime` / `endTime` from logged_times.json | Time tab | Timesheet / clock-in view |

---

## Data Gaps Remaining in Sync

| Field | Source | Priority | Notes |
|---|---|---|---|
| `approved` / `approvedAt` | logged_times.json | High | Time approval workflow |
| `lineItems[]` | invoices.json | Medium | ST invoice line detail |
| `lineItems[]` | quotes.json | Low | ST quote line detail |
| `startTime` / `endTime` | logged_times.json | Low | Timesheet view |
| `leaveBalance` | users.json | Low | Capacity planning |
| Phase date ranges | jobs.json | Medium | Gantt prerequisite |

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
