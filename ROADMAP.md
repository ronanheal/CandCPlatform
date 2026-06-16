# C&C Platform — Roadmap

*Codebase audit generated 16 Jun 2026 · v2.7.0*

---

## Data Available (what we pull from ST API)

Seven JSON files are fetched from the GitHub CDN (`streamtime-data` branch) on every load.

### `jobs.json` — mapped via `_mapStJob()`
Fields **used**: `id`, `number`, `name`, `company.name`, `jobStatus.name`, `isBillable`, `jobLabels[]`, `users[].name`, `phases[].name`, `phases[].jobPhaseStatus.name`, `phases[].items[].name`, `phases[].items[].totalLoggedMinutes`, `phases[].items[].totalPlannedMinutes`, `phases[].items[].sellRate`, `phases[].items[].jobItemStatus.name`, `looseItems[]`, `totalLoggedMinutes`, `totalPlannedMinutes`, `totalLoggedTimeExTax`, `finalBudget`, `budget`, `totalPlannedTimeExTax`, `totalLoggedExpensesExTax`, `totalIssuedInvoicesExTax`, `totalPaidInvoicesExTax`, `totalAwaitingPaymentInvoicesExTax`

Fields in raw ST response **not mapped or used**: `startDate`, `dueDate`, `description` (job brief), `jobType`, `purchaseOrderNumber`, `customFields[]`, phase-level date ranges, item-level `description`

### `logged_times.json` — stored as `stLoggedTimes[]`
Fields **used**: `id`, `userId`, `date`, `minutes`, `notes`, `itemName`, `job.id`, `job.name`, `job.number`, `isBillable`, `jobItemUser.jobItemId`

Fields **not surfaced**: `createdAt`, `updatedAt`, `approvedAt`, `approved` (approval status), `startTime`, `endTime`

### `invoices.json` — stored as `stInvoices[]`
Fields **used**: `id`, `company.name`, `jobId`, `jobName`, `jobNumber`, `sentDate`, `date` / `issueDate`, `totalAmountExTax`, `amount`, `status` / `invoiceStatus.name`

Fields **not surfaced**: `dueDate`, `lineItems[]`, `taxAmount`, `totalAmountIncTax`, `paidDate`, `notes`, `sentByUser`, `createdAt`

### `quotes.json` — stored as `stQuotes[]`
Fields **used**: `id`, `number`, `name`, `jobName`, `jobNumber`, `jobId`, `company.name`, `sentDate`, `sentByUser.name`

Fields **not surfaced**: `approvedDate`, `declinedDate`, `expiryDate`, `totalAmountExTax`, `lineItems[]`, `taxAmount`, `totalAmountIncTax`, `quoteStatus.name` (the real approved/declined/draft/sent status — the platform currently derives status from `sentDate` alone)

### `contacts.json` — stored as `stContacts[]`
Fields **used**: `firstName`, `lastName`, `email`, `phone`, `mobile`, `company.id`, `company.name` — only to backfill the primary contact when building `clientsData`

Fields **not surfaced**: `position` / `title`, secondary email, notes; only the first matching contact per company is used as primary — additional contacts are listed in client detail but are read-only

### `companies.json` — mapped via `_mapStCompany()`
Fields **used**: `id`, `name`

Fields **not surfaced**: `website`, `address`, `phone`, `accountNumber`, `industry` / `type`, notes, `createdAt`

### `users.json` — mapped into `stUsersById{}`
Fields **used**: `id`, `firstName`, `lastName`, `displayName`, `email`, `roles[0].name`

Fields **not surfaced**: `costRate`, `sellRate` (per-user billing rate), `capacity` (ST-defined daily hours), `startDate`, `phone`, `jobTitle`, `leaveBalance`, `active` status, ST-side team membership

---

## Currently Wired (what's shown in the platform)

### Dashboard
- Good morning / date / week number greeting
- KPIs: billable hours this week, non-billable hours this week (ST logged times + manual todos combined)
- Today's tasks: done (including ST entries rendered as task cards) and to-do list
- Team member cards: name, avatar, today's task blocks (done / to-do), foot stats (hours done / task count)
- Alerts: over-budget jobs (jobs at ≥90% budget used)
- Live jobs per client section

### Todo (list + calendar)
- Week view with Mon–Fri columns; week navigation (±weeks)
- Manual task cards: title, hours, job link, item, note, urgent flag, repeat icon
- ST logged time entries rendered as done cards with job chip, item name, billable colour, hours
- Day capacity bar: todo / done / billable / non-billable split using ST logged hours
- Drag-to-complete done divider with resize
- Person switcher to view any team member's week
- Calendar sub-view: time blocks proportional to hours, right-click context menu, edge-resize, alt+drag duplicate, show-completed toggle

### Jobs (list + detail)
- Jobs table: job number, name, company, budget bar (logged ex GST / planned ex GST), status pill, labels
- Filters: search, status, labels; hide archived; bulk select (archive / delete / label)
- Job detail **Plan tab**: phases and items with logged/planned hours, sell rate, sell used/total, status badge; phase collapse; drag-to-reorder items; per-item avatar stack with logged-hours tooltip; per-item progress bar (green/amber/red); non-billable lock badge
- Job detail **Time tab**: all ST logged time entries for this job (person, date, item, note, hours)
- Job detail **Expenses tab**: expense records with status badges (draft / approved / invoiced)
- Job detail **Quotes tab**: ST quote list (number, name, status heuristic, sent date, sent by, budget)
- Job detail **Invoices tab**: ST invoice records (company, inv #, job, sent date, status, amount inc GST)
- Job detail **Activity tab**: manual activity log
- Stats strip: hours logged/planned, sell used/planned, expenses, invoiced ex GST, paid ex GST

### Jobs → Time sub-tab (top-level tab)
- Full ST logged times across all jobs; period and person filters; per-person expandable groups

### Jobs → Quotes sub-tab
- Quote list with search, client filter, status filter (derived from sentDate); expandable card detail

### Jobs → Invoices sub-tab
- "To Be Invoiced" mode: completed jobs awaiting invoice (company, job, logged ex GST, ST invoiced ex GST)
- "All Invoices" mode: ST invoices table (company, inv #, job, sent date, status, total inc GST)

### Jobs → Clients sub-tab
- Client cards: name, primary contact name/email/phone, ST contacts listed per company, active jobs with budget bars, lead assignment

### Reporting (four sub-tabs, period filter)

**Business:** total hours, billable hours, revenue invoiced, revenue paid, active jobs KPIs; hours-per-week trend bar chart; billable vs non-billable doughnut; over-budget job list

**People:** per-person cards (hours, billable %); hours-by-person bar chart; hours-by-day-of-week chart; full breakdown table

**Jobs:** hours-by-job bar chart; budget-used bar chart; scrollable job list with inline progress bars

**Clients:** client cards (hours, jobs, revenue); hours-by-client bar chart; revenue-by-client bar chart

All tabs: period filter (week / 2 weeks / month / quarter / year / all time); Export CSV

### Boards
- Board listing (client boards, people boards, custom boards)
- Board detail: Kanban columns, drag-and-drop cards, add card (from job or blank), add/rename/delete column
- People board: per-person lane with hours bar, capacity %, task count, urgent count, freetext notes field

### Settings
- Team member management (add / remove / edit; assign teams; role; capacity days)
- Job plan item types management
- Expense types management
- My Profile: choose which teams appear on dashboard

---

## Not Yet Wired (data available but unused)

### From `jobs.json`
- **`startDate` / `dueDate`** — job dates are never mapped. No deadline view, no overdue detection in the Jobs list or Dashboard, no calendar population from job dates.
- **Job `description` / brief** — the ST job description is not mapped. The platform has a local `notes` field but it is separate and not populated from ST.
- **`purchaseOrderNumber`** — client PO number is not shown on job detail or invoices.
- **Phase date ranges** — phase start/end dates from ST are not mapped or displayed.
- **Item `description`** — line-item descriptions inside phases are ignored.
- **`customFields[]`** — ST custom fields are dropped entirely.

### From `logged_times.json`
- **`approved` / `approvedAt`** — time entry approval status is fetched but never surfaced. No approval workflow or unapproved-time alert exists.
- **`startTime` / `endTime`** — if ST exports these, they are not used. Only `minutes` (duration) is used.

### From `invoices.json`
- **`dueDate`** — not shown in the All Invoices table (only `sentDate` is displayed). Overdue logic on the To Be Invoiced tab uses only a locally set `invDueDate`, not the ST `dueDate`.
- **`lineItems[]`** — ST invoice line items are not rendered anywhere. Invoice detail is built from the job plan, not from ST invoice lines.
- **`taxAmount` / `totalAmountIncTax`** — the table shows `totalAmountExTax`. GST-inclusive totals are available but not displayed.
- **`paidDate`** — the date payment was received is not stored or shown. No days-to-payment metric.
- **`notes`** — invoice-level notes from ST are discarded.

### From `quotes.json`
- **`quoteStatus.name`** — the real approved/declined/draft/sent status is not used. The platform derives status only from `sentDate` (has sentDate = "sent", no sentDate = "draft"). Approved and declined states are invisible.
- **`approvedDate` / `declinedDate`** — not surfaced.
- **`expiryDate`** — quote expiry is not surfaced. No expiring-soon detection.
- **`totalAmountExTax`** — quote value is not shown in the Quotes list or anywhere else.
- **`lineItems[]`** — ST quote line items are not used; the platform generates its own quote from the job plan.

### From `contacts.json`
- **Multiple contacts per company** — only the first matching contact is used as primary; the rest are listed read-only in client detail with no add/edit/delete.
- **`position` / `title`** — contact job titles are not shown.
- **Contact `notes`** — discarded.

### From `companies.json`
- **`website`** — company website URL is not surfaced anywhere.
- **`address`** — not stored or shown.
- **`phone`** (company-level) — not used; only contact-level phone is shown.
- **`accountNumber`** — not surfaced.
- **`industry` / `type`** — discarded.

### From `users.json`
- **`costRate`** — staff cost rates from ST are not mapped. No profitability calculation exists anywhere in the platform.
- **`sellRate`** — per-user default sell rate is not used (item sell rates are used instead).
- **`capacity`** — ST-defined daily/weekly capacity per person is not read. The dashboard uses a hardcoded 30h/week billable target for everyone.
- **`leaveBalance`** — not surfaced.
- **`startDate`** — not used.

---

## Proposed Features (prioritised)

### Quick Wins (1–2 days each)

**0a. Dashboard customisation section in Settings**
Add a "Dashboard" section in Settings with toggles per person: show/hide Teams block, Business KPIs, Clients block; choose which clients appear on the dashboard. Store preferences in `people[MY_PERSON].dashSettings`. Note: admin-across-accounts (pushing these preferences to all users) is a future feature — for now each user sets their own.

**0b. Todo — day indicator inside column box**
The day-of-week / date label currently sits above the column pushing content down. Move it inside the column box as an overlay or top-pinned label (position:absolute) so it doesn't affect card layout or total zone height.

**0c. Todo — overflow bucket fix**
Confirm overflow bucket triggers correctly when total card heights exceed `todoSplitPx`. Currently bucket threshold logic may be off after the absolute-scale card resize refactor.

**0d. Calendar — time line alignment fix**
Hour grid lines in the calendar sub-view are misaligned with card positions. Audit the `pxPerHr` calculation used for grid lines vs card heights and ensure they use the same base value.

**0e. Jobs — more filter options**
Add filters to the Jobs list: date range (start/due), lead person, team, workflow stage (Quote/Live/Completed/Invoiced), budget health (on track / at risk / over). All data fields are already mapped.

**0f. Clients — more filters + stats**
Add to the Clients list: search by contact name/email, filter by active/inactive, sort by hours or revenue. Show per-client stats chips (total logged hours, invoiced revenue, active job count).

**0g. Clients — add/edit UI for company fields**
Build an edit form on client detail for website, phone, address, notes. Write to localStorage until ST write-back exists. (Same scope as roadmap item #14 but for company fields, not contacts.)

**1. Quote value and real status from ST**
Surface `totalAmountExTax` from `stQuotes[]` as a column in the Quotes table. Replace the `sentDate` heuristic with `quoteStatus.name` (approved / declined / sent / draft) to show real status pills. Add `approvedDate` / `declinedDate` / `expiryDate` to the expanded detail row. All data is already fetched; only the render loop needs updating.

**2. Invoice due date and overdue flag in All Invoices table**
Map `dueDate` from `stInvoices[]` and add it as a column. Highlight rows where `dueDate < today` and `status !== 'Paid'` in red with a "Overdue Nd" badge (the logic already exists for local `invDueDate` — replicate it for the ST field).

**3. Job start date and due date in job detail meta line**
Map `startDate` and `dueDate` from `_mapStJob()` and show them in the job detail meta line alongside the team avatars. Add a "Due soon (≤7 days)" alert row on the Dashboard using the same red-bar alert list that shows over-budget jobs.

**4. Company website link on client detail**
Map `website` from `companies.json` into `_mapStCompany()` and render it as a clickable `<a href>` link on the client detail card. Trivial to wire — the field is in the response.

**5. Quote expiry alert on Dashboard**
Add a Dashboard alert (same red-bar list as over-budget jobs) for quotes that have `expiryDate` within 7 days and `quoteStatus.name` is not `approved`. Uses already-fetched data.

**6. ST capacity per person replaces hardcoded 30h target**
Read the `capacity` field from `users.json` during `initStreamtime()` and store it on each person in `stUsersById`. Use it in the Dashboard billable KPI bar and the day-column capacity bar on the Todo view instead of the hardcoded `totalTarget=30`.

**7. Invoice paid date and paidDate column**
Map `paidDate` from `stInvoices[]` and add a "Paid date" column to the All Invoices table. Use it to sort and filter paid invoices. This also enables a Days Sales Outstanding metric (average days from `sentDate` to `paidDate`).

---

### Medium (3–5 days each)

**8. Profitability per job using costRate**
Map `costRate` from `users.json` into `stUsersById`. In the Job detail stats strip, add a "Staff cost" stat: `Σ (lt.minutes/60 × costRate)` across all logged times for the job. Show gross margin = invoiced revenue − staff cost − expenses. This is the single highest-value data gap — all raw data is already fetched.

**9. Time approval workflow**
Surface `approved` / `approvedAt` from `stLoggedTimes[]`. Add an "Unapproved" filter to the Time sub-tab. Show a Dashboard alert "N unapproved time entries this week" when any entries have `approved === false`. A manager click writes approval status to localStorage (as a stopgap until write-back API exists).

**10. Job due-date calendar / deadline view**
Add a month-view calendar to the Dashboard or a new sidebar view. Populate it with job `dueDate`, quote `expiryDate`, and invoice `dueDate` values. Colour-code by type. This closes the "what's coming up" gap that is the most obvious absence for a production agency.

**11. "Needs attention" smart filter in Jobs list**
Add a filter button that shows: jobs over 80% budget used with no invoice, quotes with no response after 7 days (using `sentDate`), and jobs past their `dueDate` still marked In Play. Uses only already-computed fields (`_bPct`, `dueDate`, `sentDate`).

**12. Per-client revenue trend in Clients reporting tab**
Add a bar chart of invoiced revenue per month per client using `stInvoices` filtered by `company.name`. The Clients tab currently shows only a single total — a month-by-month breakdown answers "are we growing with this client?".

**13. Utilisation report in People reporting tab**
Add a utilisation table: per person per week, show `billable hours / capacity hours` as a percentage, coloured against a target (e.g. 75%). This is the number agencies actually manage by. Requires mapping `capacity` from `users.json` (Quick Win #6) as a prerequisite.

**14. Contact management per client (add/edit)**
Extend the client detail page to allow adding and editing contacts with `firstName`, `lastName`, `email`, `phone`, `position`. Write to localStorage until a write-back API exists. Currently contacts are read-only from ST; agencies routinely need to add direct contacts that are not yet in ST.

---

### Large (1+ week each)

**15. Staff profitability and utilisation dashboard**
Combine `costRate` (users), `stLoggedTimes` (hours by person), `stInvoices` (revenue by job), and `_plannedSell` (budget) to produce a proper P&L view. Per person: hours capacity vs logged, billable %, revenue generated (hours × sellRate), staff cost (hours × costRate), gross contribution. Per job: revenue, cost, margin %. Add as a "Profitability" sub-tab in Reporting. Currently impossible because `costRate` is not mapped — this is the roadblock item.

**16. Job timeline / Gantt view**
Using `startDate` and `dueDate` from jobs, and phase date ranges (once mapped), build a horizontal Gantt chart showing all live jobs on a timeline. Drag to reschedule writes to localStorage. Requires mapping phase dates and building a chart component (no suitable Chart.js type; would need SVG rendering or a library like frappe-gantt).

**17. Quote-to-invoice pipeline funnel**
Build a funnel view: Quotes sent → Approved → Jobs live → Jobs complete → Invoiced → Paid. Use `stQuotes` (with `approvedDate`), `jobs` (with status), and `stInvoices` (with `paidDate`). Show conversion rates and average time at each stage. This is the primary business-development metric an agency owner needs and is unavailable today.

**18. ST write-back for time logging**
The platform is currently read-only from ST. Add a "Log time" action on the Todo view and job detail that POSTs to the Streamtime API (`POST /logged-times`). Requires Streamtime API credentials (stored in a GitHub secret) and a small serverless proxy (Cloudflare Worker or Vercel Edge Function). This closes the loop between planning in C&C and logging in ST — currently the two are separate workflows.

**19. Purchase order tracking**
Map `purchaseOrderNumber` from `jobs.json`. Surface it on job detail, the invoices table, and the invoice print template. Add a PO filter to the Jobs list. This is a routine accounts-receivable need blocked only by the field not being mapped.

**20. Workspace export / import and multi-user sync**
Add Settings → "Export workspace" (one JSON blob of all localStorage: jobs, todos, boards, people) and "Import workspace". This is existential data insurance — currently a single browser's localStorage is the only copy of manual data. Longer term, sync a shared blob to a KV store or S3 bucket so all team members share one source of truth. The current `cc_jobs` / `cc_todo` localStorage keys are the starting point.

---

## Existing Roadmap Items (from CHANGELOG in codebase)

Items from the `CHANGELOG` array in `index.html`, latest first:

**v2.7.0 (16 Jun 2026):** Reporting redesign — four sub-tabs (Business / People / Jobs / Clients), per-tab CSV export, avatar overflow tooltip listing members and hours.

**v2.6.0 (16 Jun 2026):** ST logged times fully unified — same card style in todo and calendar, clickable ST entry modal, day capacity bar counts ST hours, Dashboard and Reporting pull from ST as primary source, job plan non-billable lock badge.

**v2.5.0 (15 Jun 2026):** Invoice overhaul — table design, "To Be Invoiced" filter, invoice ⋮ menu (view/open job/mark status/delete), overdue detection, phase delete undo toast, todo person picker team grouping, per-item progress bars.

**v2.4.0 (15 Jun 2026):** Client nicknames, job pause, dashboard "+ task" button, Clients section on dashboard, label filter on jobs list, quote approval auto-advances job to Live, Completed workflow stage.

**v2.3.0 (12 Jun 2026):** Searchable client/item dropdowns, drop-at-indicator reordering fixed, live divider rescaling, calendar live-reflow on resize, repeat-on-edit, board card deduplication + live-view labels.

**v2.2.0 (12 Jun 2026):** Edge-resize restored, job number deduplication, board/column delete fixed, task modal delete restored, time view per-person groups collapsed, Settings My Profile section.

**v2.1.0 (12 Jun 2026):** Job detail Progress tab (per-person time table with reallocation), C&C logo on quotes and invoices, team assignment in Settings, content-sized todo cards.

**v2.0.0 (12 Jun 2026):** Global search (⌘K), persistent team members in Settings, quote/invoice print/PDF, bulk job actions, global labels, keyboard shortcuts, activity log.

**v1.9.0 (10 Jun 2026):** Job plan stats live from phases, quote redesign (Streamtime-style), Create dropdown (item/phase/todo/expense/invoice/quote), Settings gear modal, calendar edge-resize and alt+drag, Clients Lead field, Expenses restyle.

**v1.8.0 (10 Jun 2026):** Calendar done divider fix, drag between days, right-click context menus, inline expenses, toast notifications replacing alert(), people boards with capacity bars, Settings for item and expense types.

**v1.7.0 (9 Jun 2026):** Calendar view, completed drawer, filter chips, board column types (Client/Person/Generic), job plan logged/planned hours column, workflow badge advance, expenses form rebuild, card live-resize.

**v1.3.0 (9 Jun 2026):** Job plan fix, reporting chart fix, date picker in task modal, repeat tasks (never/N occurrences/until date), skip weekends, changelog introduced.

**v1.2.0 (7 Jun 2026):** Jobs sub-tabs (Jobs / Time / Expenses / Quotes / Invoices / Clients), workflow stages Quote → Live → Invoiced, inline-editable plan items, task modal redesign.

### Items from the previous ROADMAP.md (v2.2.0) still not shipped

- **Rollover prompt:** Monday open → "4 unfinished tasks from last week — move them?" (highest todo hygiene win)
- **"Uninvoiced work" report:** approved quotes + logged time minus invoiced = money earned but not asked for
- **Quote versioning:** revise after client feedback without losing v1 (v1/v2 with total diff)
- **Deposit / split invoicing:** 50% on approval, balance on delivery
- **Studio board preset:** one auto-board of all live jobs by workflow stage, zero setup
- **Date-range picker in Reporting:** month-end reporting needs "1–31 May" not just relative periods
- **Workspace export/import:** Settings → Export/Import one JSON file (data safety)
- **Capacity warnings while booking:** tint day header when adding to an already-full day
- **Per-person default rate in Settings:** feeds new items and utilisation reports
- **Working hours per person in Settings:** the `days` field exists; 8h/day is hardcoded
- **Quiet-client flag:** no active job in N weeks → dashboard nudge
