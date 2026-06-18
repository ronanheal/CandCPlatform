# C&C Platform — Roadmap

*Last updated 18 Jun 2026 · v2.18.0*

---

## What's Live (v2.16.0)

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
- **Write-back** — platform is read-only from ST today; write-back requires serverless proxy

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
