# Data model

*How the platform represents its data internally, where each field comes from in Streamtime (ST), which fields exist only in the platform, and how native data is persisted. Code references are `index.html:<line>` at commit `b6f7efb` (search by function name if lines have moved). Export statistics come from the `streamtime-data` branch as of 8 Nov 2026 20:10 UTC.*

---

## 0. Conventions you need first

**Two layers per entity.** Most screens read an *internal shape*. For jobs, phases, items, companies and users, a mapping function builds that shape from raw ST records. For logged time, invoices, quotes, expenses, assignments and contacts there's **no mapping step**: the app reads the raw ST record directly, so its field names *are* the contract. Native (platform-created) records copy those shapes, so one code path renders both.

**Identifiers**

| Thing | Internal id | Notes |
|---|---|---|
| Job | `String(job.number \|\| job.id)`, e.g. `"6797"` (`_mapStJob`, `index.html:3637`) | The **job number** is the primary key everywhere in the UI (`jobs.find(x=>x.id===…)`). The ST internal id is kept as `_stId`. Native jobs get the next number after the highest seen, with a floor of 6953 (`nextJobNumber`, 3876) |
| Phase | `st-ph-<stId>`, `st-ph-loose-<jobStId>` (synthetic "General" phase), or native `uid('ph')` / `uid('p')` | |
| Item | `st-it-<stId>`, or native `uid('it')` / `uid('i')` | |
| Person | key `st_<stUserId>`, e.g. `st_114330`; legacy local keys like `ro`, `bee`, `jb` and name slugs for people added in Settings | `MY_PERSON` is hard-coded to `st_114330` (2772) |
| Client | `st-<companyStId>` or native `uid('cl')` | Jobs link to clients **by company name string**, not by id (`j.company`, `clientsData.find(c=>c.name===…)`) |
| Native ids | `uid(prefix)` = prefix + base36 timestamp + counter + random (2630) | Exceptions: native quotes use `Date.now()` (9072), and inline/modal expenses use `'e'+Date.now()` (8764, 8896) |

**Provenance tags on records**

| Tag | Meaning |
|---|---|
| `_streamtime: true` | Job built from ST by `_mapStJob` |
| `_stId` | ST internal id of the source record |
| `_local: true` | Created natively (job, phase, item, time entry, quote, expense). Drives what `persistNativeData` saves |
| `_native: {…}` | On an ST job: field patches from `dbUpdateJob`, re-applied after every ST re-fetch |
| `_isNative: true` | Native milestone |
| `_manualPaused` | Pause set in the platform (not ST) |
| `_fromStreamtime` / `_fromCache` | Person record seeded from ST `users.json` / rebuilt from cache when `users.json` failed (3762) |

**Units and formats** (the biggest source of bugs in the past, per the ROADMAP audit):
- ST durations are **integer minutes** (`minutes`, `totalLoggedMinutes`). Board tasks use **float hours** (`hours`).
- **Job-plan items store display strings**: `hours: "2h30m"`, `rate: "$150"`, `total: "$1,500"`, `used: "$0"` (`_mapItem` 3655, `saveItem` 8694). Arithmetic re-parses them with `parseHrsInput` / `replace(/[$,]/g,'')` (e.g. `computeJobStats` 7306). The numeric source values are kept only on ST items (`_planMins`, `_logMins`). The backend should store numbers and convert to these strings at the edge, or the front end will need adapters.
- Money is NZD ex GST unless a field says `IncTax`. GST is a hard-coded 15% in native documents (e.g. native quote `totalAmountIncTax`, 9078). Three jobs use a USD rate card. Currency and `exchangeRate` are ignored by the app.
- Dates are `YYYY-MM-DD` strings, parsed as **local** midnight by `_pDate` (2580) because users are in NZ (UTC+12/13).

---

## 1. Source files (ST export on the `streamtime-data` branch)

Fetched by `initStreamtime` (`index.html:3714–3727`, plus `logged_times_sweep.json` 3839 and `platform_config.json` 3844).

| File | Records | Size | ST source (script) | Loaded into |
|---|---|---|---|---|
| `jobs.json` | 2,732 | 21.9 MB | search view 7 + `/jobs/{id}/job_phases` + `/jobs/{id}/job_items` (`streamtime_sync.py:227, 143`) | `jobs` via `_mapStJob` |
| `logged_times.json` | 15,555 | 53.3 MB | view 8 (status 2 "Logged") | `stLoggedTimes` (raw) |
| `scheduled_todos.json` | 797 | 0.2 MB | view 8 `logged_time_status = 1`, slimmed by the script (`streamtime_sync.py:358–373`) | `stScheduledTodos` |
| `job_assignments.json` | 2,191 | 0.8 MB | view 17, active jobs only | `stJobAssignments` (raw) |
| `invoices.json` | 83 | 0.2 MB | view 11 | `stInvoices` (raw) |
| `quotes.json` | 89 | 0.1 MB | view 10 | `stQuotes` (raw) |
| `companies.json` | 101 | 66 KB | view 12 | `clientsData` via `_mapStCompany` |
| `contacts.json` | 238 | 77 KB | view 13 | `stContacts` (raw) |
| `users.json` | 37 | 32 KB | `GET /users` | `stUsersById` and `people` |
| `expenses.json` | 266 | 0.4 MB | view 9 | `stExpenses` (raw) |
| `milestones.json` | 6 | <1 KB | view 18 | `stMilestones` (raw) |
| `logged_times_sweep.json` | — | — | written by `logged_times_sweep.py` (unpushed, so **absent on the branch today**) | `stSweepState` (freshness indicator) |
| `sync_meta.json`, `sync_progress.json` | — | — | sync bookkeeping | not read by the app |
| `organisation.json`, `branches.json`, `roles.json`, `rate_cards.json` | 1 / 2 / 21 / 2 | — | reference endpoints | **not read by the app** |
| `platform_config.json` | — | 27 KB | written by the browser (`publishConfig`) | `people`, `globalLabels`, `LINE_ITEMS`, `EXPENSE_ITEMS` |

The browser downloads all of these, about 77 MB, on every page load **and every 5 minutes** (`setInterval`, 11807). Each request carries a `?v=Date.now()` cache-buster (3713), so nothing is ever cached.

---

## 2. In-memory globals (the "database" today)

| Global | Declared | Holds |
|---|---|---|
| `jobs` | 2725 | Internal job objects (ST-mapped + native), each with nested `phases[].items[]`, `activity[]`, `expenses[]`, `milestones[]`, `splitInvoices[]` |
| `phases` | 2728 | Working copy of the **open** job's phases. `saveData` copies it back into the job (3404–3407) |
| `stLoggedTimes` | 3488 | Raw ST logged-time records + native time entries (`_local`) |
| `stScheduledTodos`, `stJobAssignments`, `stInvoices`, `stQuotes`, `stExpenses`, `stMilestones`, `stContacts` | 3489–3504 | Raw ST records |
| `stUsersById` | 3506 | ST user id → `{id,name,initials,color,key,email,active,capacityH,billableRate,costRate,costRateIsDefault}` |
| `_stIdToJobNum` | 3507 | ST job id → job number |
| `localQuotes` | 3493 | Native quotes (`cc_local_quotes`) |
| `clientsData` | 9580 | Client records (`cc_clients`) |
| `people`, `personStatus` | 2730, 3384 | Team map (`cc_people`, `cc_person_status`) |
| `boardsList` | 12433 | Boards (`cc_boards`) |
| `globalLabels` | 2708 | Label catalogue (`cc_labels`) |
| `LINE_ITEMS`, `EXPENSE_ITEMS` | 2513, 2515 | Item/expense name catalogues |
| `workspaceSettings` | 3496 | `{defaultCostRate, paymentTerms}` (`cc_ws_settings`) |
| `todoData` | 3397 | To Do board: `todoData[personKey][weekStartISO][day 1–5] = [task…]`. **In-memory only**, rebuilt from ST |
| `_expSubEdits` | 8903 | Itemised expense sub-lines. **In-memory only** |
| `invCounter` | 2726 | Next job-level invoice number. Starts at **1001 every session** and is never persisted |

---

## 3. Entities

Each section covers: the internal shape, the ST source and mapping, the native-only fields, and how it's persisted.

### 3.1 Job

**Mapping:** `_mapStJob(j)` at `index.html:3619–3689`, called at 3774 (`jobs=raw.map(_mapStJob)`), then `applyNativeData()` (3458) re-applies native data on top.

| Internal field | Type | ST source field (jobs.json) | Notes |
|---|---|---|---|
| `id` | string | `number` (fallback `id`) | 48 jobs have a null `number`, so their id is the 7-digit ST id; one has `"N/A"`; numbers `4474`, `4483`, `4438` appear twice (see §6) |
| `_stId` | int | `id` | |
| `_streamtime` | bool | constant `true` | |
| `name` | string | `name` | |
| `company` | string | `company.name` | Name, not id |
| `status` | `'inplay'\|'complete'\|'archived'\|'new'` | `jobStatus.name`: In Play→inplay, Paused→**inplay**, Complete→complete, Archived→archived (3620) | `'new'` only on natively created jobs (9223). Live counts: Archived 2,553 · In Play 131 · Complete 42 · Paused 6 |
| `paused` | bool | `jobStatus.name==='Paused'` | Also set natively (`_manualPaused`) |
| `workflowStatus` | `'quote'\|'live'\|'completed'\|'invoiced'` | derived: In Play/Paused→live; Complete/Archived→`invoiced` if `totalIssuedInvoicesExTax>0` else `completed` (3624) | Platform concept with no ST equivalent. `'quote'` only arises natively |
| `billable` | bool | `isBillable` | |
| `labels` | string[] | `jobLabels[].name` | Labels are referenced **by name** |
| `startDate` / `dueDate` | ISO date \| null | `estimatedStartDate` / `estimatedEndDate` | |
| `po` | string | `purchaseOrderNumber` | (Native quote screen writes a separate `poNum`, see below) |
| `members` | person keys | `users[].id` → `stUsersById[id].key` | Users missing from `users.json` are dropped |
| `phases` | Phase[] | `phases[]` + `looseItems[]` (§3.2) | |
| `notes`, `activity`, `invNum` | | constants `''`, `[]`, `null` | Native-only content |
| `_loggedMins` / `_plannedMins` | int | `totalLoggedMinutes` / `totalPlannedMinutes` | ST-computed aggregates. **The backend must compute these after ST is retired** |
| `_sellUsed` | number | `totalLoggedTimeExTax` | |
| `_finalBudget` | number | `finalBudget` | Jobs-list budget total (matches ST footer) |
| `_plannedSell` | number | `finalBudget \|\| totalPlannedTimeExTax \|\| budget` | |
| `_expUsed` | number | `totalLoggedExpensesExTax` | |
| `_hPct`, `_bPct`, `_loggedH`, `_plannedH` | derived | | |
| `_stInvoiced` / `_stPaid` / `_stAwaitingPayment` | int (rounded) | `totalIssuedInvoicesExTax` / `totalPaidInvoicesExTax` / `totalAwaitingPaymentInvoicesExTax` | |

**In jobs.json but not mapped:** `contact` (full contact object, on 1,749 jobs), `jobLeadUserId` (934), `rateCard`, `branch`, `exchangeRate`, `createdUser`, `jobCreatedDate`, `completedDate`, `archivedDate`, `budget`, `totalPlannedExpenses*`, `totalIncomplete*`, `totalLoggedCostExTax`, `totalInvoicedExTax`, `totalDraftInvoicesExTax`, `totalApprovedQuoteExTax`, `fullName`. Note: ROADMAP lists "`description` (job brief)" as mapped, but jobs.json has **no** `description` field in the current export, and `_mapStJob` sets `notes:''`.

**Native-only job fields** (written by the platform, never by ST):

| Field | Written by | Meaning |
|---|---|---|
| `notes` | `_updateJobNotesNow` 7116 | Job notes / brief (free text) |
| `activity[]` | `logActivity` 9256, `_activityFileDrop` 9275 | `{ts:epochMs, personKey, action, detail, img?}`. **`detail` is HTML** (e.g. `Renamed job to <strong>X</strong>`). `img` is a JPEG data URL ≤720 px. `personKey` is usually `MY_PERSON` = Ronan, whoever actually did it |
| `lead` | `saveJobSettings` 7223; defaults from `client.lead` on open (6990) | Person key |
| `contact` | `saveJobSettings` 7218 | Free-text contact name |
| `quoteStatus` | `cycleQuoteStatus` 8354, `setQuoteStatus` 8361, `sendQuote` 8375 | `'draft'\|'sent'\|'approved'\|'declined'`. A job-level quote, **separate from** the ST quote records |
| `quoteNum`, `issueDate` | set on render by `renderQuoteTab` 8149–8150 | `'Q-'+job.id`, today |
| `poNum` | `updateQuoteField` 8350 (only `poNum` is passed, 8297) | PO typed on the quote document |
| `invNum`, `invStatus`, `invTotal`, `invIssueDate`, `invDueDate` | `openInvoice` 9394, `saveInvStatus` 9433, `saveInvStatusForJob` 11780, `doInvCtx` 11582 | Job-level native invoice. `invNum` comes from the non-persisted `invCounter`, so **numbers repeat across sessions**. Due date is hard-coded to +30 days (the `paymentTerms` setting is ignored) |
| `splitInvoices[]` | `saveSplitInvoice` 9484 etc. | §3.7 |
| `expenses[]` | §3.12 | Native expenses only (ST expenses live in `stExpenses`) |
| `milestones[]` | §3.13 | Native milestones only |
| `starred` | `toggleStarJob` 7258 (via `dbUpdateJob`) | |
| `_native`, `_manualPaused`, `_updatedAt`, `_createdAt`, `_local` | | Bookkeeping |
| `budget:'$0'`, `budgetTotal`, `bPct`, `hours`, `hoursTotal`, `hPct` | `createJob` 9223 | Legacy placeholder strings on natively created jobs |

**Native job creation:** the UI calls `createJob()` (9214), which builds the object inline. **`dbCreateJob` (2632) has no callers.**

**Stats for native jobs:** `computeJobStats` (7306) sums plan items and then counts logged time from **`todoData` done tasks**, which is in-memory. So a native job's "time used" resets on reload. Time can't be logged to native jobs from mark-done either: `_logTimeFromFup` returns early when `!job._stId` (6296).

### 3.2 Phase

ST source: `GET {ST_SUBDOMAIN}/jobs/{id}/job_phases` (`streamtime_sync.py:146`). Raw fields: `id, jobId, name, orderId`, and nothing else. **There is no phase status field in the export.**

| Internal | Type | Source |
|---|---|---|
| `id` | string | `'st-ph-'+id`; synthetic `'st-ph-loose-'+jobId` named "General" for items with no phase (3677) |
| `name` | string | `name` |
| `status` | `'open'\|'complete'` | `ph.jobPhaseStatus?.name \|\| ph.status` (3664). Neither field exists, so this is **always `'open'`** for ST phases |
| `paused` | bool | true when every item is Paused (3665) |
| `startDate` / `dueDate` | derived | earliest item start / latest item due (3666–3672) |
| `items` | Item[] | |
| `_local` | bool | native phases from `dbCreatePhase` only |

`orderId` (display order) isn't mapped. Phases render in array order.

Native phases are created two ways: `dbCreatePhase` (2650, modal `submitNewPhase` 4653, tagged `_local`), and `addPhase` (8771, "New Phase" button, `id:uid('p')`, **not** tagged `_local`). Native edits: rename, complete, pause, delete with undo (`pctxDo` 8802).

### 3.3 Item (job-plan line)

ST source: `GET {ST_SUBDOMAIN}/jobs/{id}/job_items`, grouped under phases by `jobPhaseId` (`streamtime_sync.py:147–157`). Export: 8,506 items on 1,387 jobs; status Complete 5,826 · In Play 2,608 · Paused 72.

**Mapping:** `_mapItem` inside `_mapStJob` (3655–3661).

| Internal | Type | ST source |
|---|---|---|
| `id` | string | `'st-it-'+id` |
| `_stId` | int | `id` |
| `name` | string | `name` |
| `description` | string | `description` |
| `hours` | display string (`"2h30m"` or `'—'`) | `totalPlannedMinutes` |
| `rate` | display string (`"$150"` or `'—'`) | `sellRate` |
| `used` | display string | round(`totalLoggedMinutes`/60 × `sellRate`) |
| `total` | display string | round(`totalPlannedMinutes`/60 × `sellRate`) |
| `status` | `'open'\|'inprogress'\|'complete'` | `jobItemStatus.name`: Complete→complete, "In Progress"→inprogress (no such value in the data), everything else→open |
| `_planMins` / `_logMins` | int | `totalPlannedMinutes` / `totalLoggedMinutes` |
| `startDate` / `dueDate` | ISO \| null | `estimatedStartDate \|\| earliestStartDate` / `estimatedEndDate \|\| latestEndDate` |

**Not mapped:** `costingMethod` (Item 8,185 · Value With Calculated Sell 308 · People 12 · Value With User Sell 1), `timeAllocationMethod` (Time By Item / Time By People), `isBillable`, `orderId`, `completedDate`, `totalPlannedTimeExTax`, `totalLoggedTimeExTax` (the ST-computed sell, which the app recomputes as minutes × rate, so the two can differ for value-costed items), all `jobCurrency*` fields, `jobCurrencyTotalAmountInvoicedExTax`, and the sub-item counts (6,673 sub-items exist in ST; their content isn't exported at all).

**Native-only item fields:** `note` (`saveItemNote` 8654). Native items: `dbCreateItem` (2656, `_local`, `status:'open'`) or `saveItem` (8694, `id:uid('i')`, **no `_local`**). Edits: `inlineEditItem` (8619, name/hours/rate, recomputes `total`), `toggleItemStatus` (8675), delete (`ctxDo` 8773).

### 3.4 Logged time (time entry)

**No mapping function.** The app reads raw ST view-8 records. The fields `index.html` actually reads are exactly those kept by `slim()` in `scripts/logged_times_sweep.py:43–61`:

| Field | Type | Used for |
|---|---|---|
| `id` | int | identity, card id `'st-lt-'+id` |
| `userId` | int | ST user id |
| `date` | `YYYY-MM-DD` | day bucket |
| `minutes` | int | hours |
| `notes`, `scheduleNotes`, `itemName` | string | card title (`notes \|\| scheduleNotes \|\| itemName \|\| job.name`) |
| `totalExTax` | number | logged sell value (Progress, Time view) |
| `completedDatetime` | ISO | |
| `loggedTimeStatus.name` | `'Logged'` | |
| `job.{id,number,name,isBillable}` | | **Billability is on the nested job.** There's no top-level `isBillable` (ROADMAP audit item 1) |
| `jobItemUser.jobItemId` | int | matches time to a plan item / scheduled block |

The **production** file still carries full raw records (job, company, rate card and branch copies, ~3.4 KB each), because the slimming commit isn't deployed. Fields present in the raw records but dropped by `slim()`: `private` (all false), `cost` (null), `totalCostExTax` (all 0, so **ST holds no time cost**), `jobItemUser.{id,userId,sellRate,jobItemUserStatus,…}`, `jobLabels`.

**Card shape:** `_getStWeekEntries` (3510) turns entries into To Do "done" cards (§3.5).

**Native time entries:** `dbCreateTimeEntry` (2646), called by `_logTimeFromFup` (6286, the hours prompt on mark-done) and `_cmdLogTime` (10546, ⌘K). Shape:
```js
{ id:'lt…', _local:true, userId:<ST user id>, date:'YYYY-MM-DD', hours:<float>, minutes:round(hours*60),
  job:{id:<ST job id>, number:'6797', name, isBillable}, jobId:<ST job id> /* fup only */,
  itemId, itemName, notes }
```
Since commit `7ee5329` (after `b6f7efb`), `_logTimeFromFup` uses the local date and adds `jobItemUser:{jobItemId}`. Before that it used the UTC date, so entries made before 1 pm NZ were dated the previous day, and the "No thanks" button on the follow-up prompt also logged the pre-filled hours. `dbCreateTimeEntry`'s own default date (2647) is still UTC-based. Pushed into `stLoggedTimes` and persisted in `cc_native_time`. On every load, natives whose signature `userId|job.number|date|minutes` matches an ST entry are dropped (3806–3818). That dedupe is fragile: change the minutes in ST and the native copy double-counts forever, and two genuine identical entries collapse into one.

**Missing from the export entirely:** approval (`approved`/`approvedAt`), start/end times, entries dated before **2025-07-08** (the export starts there; jobs go back to 2023).

### 3.5 Scheduled todo and To Do board task

**ST source:** view 8 with `logged_time_status = 1` ("Scheduled"), slimmed by the sync script to:
`{id, userId, date, minutes, notes, scheduleNotes, itemName, jobItemId, jobId, jobNumber, jobName, isBillable}` (`streamtime_sync.py:360–373`; same code in `streamtime_fast_sync.py:145–158`). Export: 797 blocks, dated 2025-11-10 → 2027-10-27 (33 before 1 Nov 2026, so some stale undone blocks).

**Internal task-card shape** (`_getStWeekAssignments` 3572, `_getStWeekEntries` 3510, `saveTodo` 6655):

| Field | Type | Notes |
|---|---|---|
| `id` | string | `'st-todo-'+id`, `'st-lt-'+id`, or native `uid('t')` |
| `title`, `titleNoNote` | string | |
| `hours` | float | |
| `done` | bool | scheduled block done if its item has logged time the **same day** (`seedWeekFromST` 3907–3931), or if the matching assignment is Complete (`_completedAssignmentLookup` 3563) |
| `urgent`, `personal`, `repeat`, `repeatGroup` | bool / id | native-only |
| `job` | string | `"6797 Job name"` for native tasks, the bare number for ST cards |
| `jobId`, `item`, `itemId`, `_stItemId` | | |
| `person` | person key | |
| `_fromST`, `_stScheduled`, `_stAssignment`, `_completedViaAssignment`, `_completedViaLog` | bool | provenance |
| `minutes`, `jobName`, `billable` | | legacy fields read by the dashboard and capacity code |

**Persistence: none.** `todoData` is rebuilt from ST lazily per (person, week) (`getWeekData` 3933) and **wiped by `resetTodoStore()` at the end of every `initStreamtime`** (3861), which runs every 5 minutes. Every board action (create, edit, drag between days, resize, split across days, duplicate, delete, reassign, rollover, repeat, reallocate) is lost within 5 minutes or on reload. That's by design for Phase 1 (comment at 3391–3396), but it's the biggest functional gap the backend has to close. The only board action that persists is the **time entry** created on mark-done.

### 3.6 Assignment (job item user)

Raw ST view 17, filtered to `job_status in ["In Play","Paused"]` (`streamtime_sync.py:347`). Fields: `id, jobItemId, userId, jobItemUserStatus.{id,name}` (In Play 1,944 · Complete 200 · Paused 47), `sellRate, totalPlannedMinutes, totalIncompleteMinutes, totalLoggedMinutes, totalPlannedTimeExTax, totalLoggedTimeExTax, completedDate, earliestStartDate, latestEndDate`.

The app reads only `jobItemUserStatus.name`, `jobItemId`, `userId` and `completedDate`, to mark To Do blocks done when an item was completed in ST without logged time (`_completedAssignmentLookup` 3563). Per-person planned minutes aren't used. **There's no native write path.** Assignments on archived/complete jobs (about 28k per the script comment) aren't exported.

### 3.7 Invoice

There are **three separate invoice concepts**:

**(a) ST invoices.** Raw view 11 → `stInvoices`, no mapping. Read in `renderInvoices` (11609) and `openInvoiceDetail` (11448). Fields used: `id, number, jobId` (ST job id, resolved via `jobByStId`), `company.name, invoiceStatus.name` (Draft / Awaiting Payment / Paid / Voided), `invoiceDate, sentDate, dueDate, paidDate, totalAmountExTax, totalAmountIncTax, amountPaidIncTax, balance`. Also present: `reference, name, invoiceType` (all "Invoice"), `instalment, sentTo[], invoiceLabels[], currencyCode, exchangeRate, invoiceCurrency*`, and the Xero link `externalAccountingPlatformName` ("Xero") / `externalInvoiceId`. **There are no line items** (ROADMAP "Blocked"). The export holds only **83 invoices, all branch "C&C Global Limited", dated 2026-02-28 → 2026-10-31**, while 2,162 jobs report `totalIssuedInvoicesExTax > 0`. Why view 11 returns this subset is unknown.

**(b) Job-level native invoice.** Fields on the job: `invNum, invStatus ('draft'|'sent'|'paid'), invTotal, invIssueDate, invDueDate` (see §3.1). The document lines are rebuilt from the job plan at render time (`renderInvoice` 9522). "Copy to Xero" puts a CSV on the clipboard (`copyInvoiceToXero` 9564); nothing is pushed to Xero.

**(c) Split / deposit invoices.** `job.splitInvoices[]` = `{id:'si…', label, pct|null, amount, status:'draft'|'sent'|'paid', date}` (`saveSplitInvoice` 9484, `cycleSplitInvoiceStatus` 9498, `deleteSplitInvoice` 9505). Totals use `_splitInvTotal` (9442): `_stInvoiced || _plannedSell` for ST jobs.

### 3.8 Quote

**(a) ST quotes.** Raw view 10 → `stQuotes`. Fields used: `id, quoteName, quoteNumber, quoteStatus` (**a string**: Draft 32 · Approved 27 · Pending Approval 25 · Declined 5), `quoteStatusId, company` (**a string**, not an object), `jobId, jobNumber, jobName, quoteDate, sentDate, sentByUser` (string username), `approvedDate, approvedBy, totalAmountExTax, totalAmountIncTax`. Status normalisation: `qtRealStatus` (11494): approv→approved, declin→declined, pending/sent/has `sentDate`→sent, else draft. Export range 2026-04-14 → 2026-11-06 only. No `expiryDate`, no `declinedDate`, no line items.

**(b) Native quotes.** `localQuotes` / `cc_local_quotes`, created by `saveNewQuote` (9061) in the ST shape:
`{id:Date.now(), _local:true, quoteName, quoteNumber:'Q-'+last6, company, jobId:null, jobNumber, jobName, quoteStatus:'Draft', quoteDate, sentDate:null, approvedDate:null, totalAmountExTax, totalAmountIncTax:×1.15, sentByUser, notes}`. There's no edit or delete path for native quotes.

**(c) Job-level quote fields** on the job: `quoteStatus`, `quoteNum`, `issueDate`, `poNum` (§3.1). The quote document's lines are the job plan.

**Quote versions** (local revision history keyed by quote id): `cc_quote_versions = {<quoteId>: [{date, valueExTax, note}]}` (`saveQtVersion` 11432, `deleteQtVersion` 11442).
**Quote display options** per job: `cc_quote_opts = {<jobId>: {showJobNum, showQuoteNum, showDescriptions, showQty, showUnitRate, showSubtotals, showTax, showTCs}}` (7698–7707).

### 3.9 Company / client

**Mapping:** `_mapStCompany(c, contacts)` (3691–3703). Merged into `clientsData` **by name** in `initStreamtime` (3786–3803): new companies are appended, and existing records only have blank `contact/email/phone` back-filled. **Once a company is in `cc_clients`, later ST changes (address, notes, website, contacts) never reach it.**

| Internal | Source |
|---|---|
| `id` | `'st-'+c.id` (native: `uid('cl')`) |
| `_stId` | `c.id` |
| `name` | `c.name` |
| `contact`, `contactTitle`, `email`, `phone` | first contact whose `companyId` matches (`firstName lastName`, `position`, `email`, `phoneNumber`) |
| `website` | `websiteAddress \|\| website` (null for all 101) |
| `companyPhone` | `phone1 \|\| phone2` |
| `address` | `physicalAddress \|\| postalAddress` → `line1, line2, city, country`. The export calls it `countryName`, so the country is always dropped, and `line3`, `region` and `postCode` aren't used |
| `notes` | `c.notes` |
| `contacts[]` | `{id, firstName, lastName, email, phone, position}` for every matching contact |
| `nickname` | `''` |

**Native-only client fields:** `nickname`, `group` (master-client grouping), `lead` (person key), and `localContacts[]` = `{name, role, email, phone}` (`updateClientField` 9853, `addClientContact` 9857, `updateLocalContact` 9867, `deleteClientContact` 9863). New clients come from `saveNewClient` (9898). **`renderClients` auto-creates a stub client** for every distinct `job.company` with no record (9588–9593). There's no client delete.

**Not mapped:** `companyStatus` (Active 44 · Archived 57), `branchId/branchName`, `rateCardId`, `taxNumber`, `companyLabels`, `companyLeadUserId` (all null). Ten companies referenced by jobs (all ST status "Deleted") aren't in `companies.json`.

### 3.10 Contact

Raw view 13 → `stContacts`, read in the client detail panel (9734) and `_mapStCompany`. Fields: `id, firstName, lastName, email, phoneNumber, position, notes, active, companyId, contactStatus.name, contactLabels`. ST contacts are read-only in the platform. Native contacts are `client.localContacts[]` (above), which is a different shape. 238 contacts, all linked to a company in `companies.json`.

### 3.11 Person / user

**From ST** (`initStreamtime` 3731–3758): each `users.json` record becomes
`stUsersById[u.id] = {id, name:'first last', initials, color:<palette by index>, key:'st_'+id, email, active:userStatus.name==='Active', capacityH:(Mon..Fri hours)/5 or 8, billableRate, costRate:u.costRate || workspace default (150), costRateIsDefault}` (3744).
If `people[key]` is missing, it's created as `{name, initials, color, role:roles[0].name||role.name, days:[1..5], _stId, _fromStreamtime:true}` (3747–3754). Existing people entries **aren't** refreshed from ST.

**`people` map (native).** Key → `{name, initials, color, days:int[], role, team, hoursPerDay, rate, _stId, _fromStreamtime, _archived, dashTeams[], dashHide[]}`. Edited by `updatePerson` (10460: name/role/color/team/hoursPerDay/rate), `saveNewPerson` (10468, local-only people with no ST id who can't log time), `toggleArchivePerson` (10482), `deletePerson` (10488, which also strips the person from job members/lead). `dashTeams`/`dashHide` are **per-user dashboard preferences stored on `people[MY_PERSON]`** (10443, 10451).
`personStatus` = `{personKey: 'available'|'allocated'|…}` (`changePersonStatus` 6167).

ST data quality: `costRate` is 0 for 36 of 37 users (so profitability uses the $150 default). Status: Active 16 · Hibernated 19 · Deleted 2. Not mapped: `role.id`, `jobTitle`, `phoneNumber`, `branch`, `labels`, weekend hours.

### 3.12 Expense

**(a) ST expenses.** Raw view 9 → `stExpenses`. The cross-job list maps them inline (`renderExpensesList` 4453–4457): `name ← itemName||description`, `cost ← totalCost`, `sell ← totalExTax`, `status ← loggedExpenseStatus` (a plain **string**: Draft 150 · Approved 110 · Declined 6), `jobId ← jobNumber`. Other fields: `type` (Expense / Purchase Order), `userId, date, reference, description, costRate, sellRate, quantity, markup, margin, totalAmountInvoicedExTax, purchaseOrderNumber, supplier*` (all null). Export range 2025-12-22 → 2026-11-09 only. ST expenses are read-only, except the itemised sub-lines below.

**(b) Native expenses** in `job.expenses[]`. **Three creation paths with different shapes:**

| Path | Shape |
|---|---|
| `dbCreateExpense` (2662) via `submitLogExpense` (4626) | `{id:'exp…', _local:true, desc, date, cost, sell, status:'draft'}` |
| `saveExpense` (8880, job Expenses modal) | `{id:'e'+Date.now(), desc, cost, markup, qty, date, sell, total, supplier, status:'draft'}` |
| `saveExpenseInline` (8753, job plan) | same as above, without `supplier` |

Edits: `saveExpenseDetail` (4575, recomputes `sell = cost × (1+markup/100)` and `total = sell × qty`), `cycleExpenseStatus` (9031: draft→approved→invoiced), `deleteExpenseDetail` (4592).

**Itemised sub-lines** (`[{label, amount}]` per expense id) are parsed from the description text and edited in `_expSubEdits` (8903), which is **in memory only and lost on reload**.

### 3.13 Milestone

**ST:** raw view 18 → `stMilestones` `{id, jobId(ST), name, date}` (6 records, all 2023–2025). Merged at render time by `_jobMilestones` (7985) as `{id:'st-ms-'+id, name, date, _source:'st', _stId}`.
**Native:** `job.milestones[]` = `{id:'ms…', name, date, _isNative:true}` via `dbCreateMilestone` / `dbUpdateMilestone` / `dbDeleteMilestone` (2672–2688), called from the Timeline tab (`saveMilestoneInline` 8042, `deleteMilestoneRow` 8074). ST milestones are read-only.

### 3.14 Activity

See `job.activity[]` in §3.1. There's no ST source: ST's job activity and comments aren't exported. Entries are generated by most job mutations (rename, status, workflow, members, items, expenses, invoices, tasks) plus manual comments and image attachments.

### 3.15 Board and card

`boardsList` / `cc_boards` (12433). Board: `{id:'b…', name, type:'custom'|'client'|'people', clientFilter?, columns?:[Column], notes?:{personKey:text}}`.
Column: `{id:'c…', name, type?:'generic'|'client'|'person', clientFilter?, personFilter?, cards:[Card]}` (`confirmAddColumn` 12897).
Card: `{id, type:'job'|'client'|'person'|'note', jobRef?|clientRef?|personRef?, note?}`. Refs are a job number, client **name** and person key.
Client and people boards render live from jobs and people. Custom boards (including the "Studio" preset, `createStudioPreset` 13064) store their cards. Moving a card **doesn't** change the job's `workflowStatus`.

### 3.16 Label

`globalLabels` / `cc_labels` = `[{name, color:'#hex'}]` (2706–2716). Seeded from every job's `labels` on load (3780) and by `platform_config.json`. Jobs store label **names**, so renaming a label isn't supported, and removing one from the catalogue leaves it on jobs.

### 3.17 Settings and catalogues

| Setting | Storage | Shared? |
|---|---|---|
| `workspaceSettings.defaultCostRate` (150), `.paymentTerms` (20, unused by invoice due dates) | `cc_ws_settings` | per browser |
| `LINE_ITEMS` (job-plan item names), `EXPENSE_ITEMS` | `cc_line_items`, `cc_expense_items` | per browser, plus shared via `platform_config.json` |
| `people`, `globalLabels` | `cc_people`, `cc_labels` | per browser, plus shared via `platform_config.json` |
| Per-user preferences: theme, wallpaper, card settings, filters/presets, hidden columns, schedule people, recent jobs, starred, rollover/changelog seen, quote options, hidden uninvoiced | see §5 | per browser |

`platform_config.json` = `{people, globalLabels, LINE_ITEMS, EXPENSE_ITEMS, published_at, published_by}`. Last published 2026-06-16 by Ronan Heal (42 people, 196 labels). On load it **overwrites** local `people` entries, labels and catalogues, unless this browser is the publisher (3843–3855).

### 3.18 Other native data

- **Starred items:** `cc_starred = [{key:'type:id', type, id, name, ts}]` (`toggleStarItem` 2697). Jobs additionally use `job.starred`.
- **Mood check-in:** `cc_happiness = {personKey: {weekStartISO: {score:1–5|null, note, skipped?, ts}}}` (4222–4273). The code comment (4214–4221) notes this is device-local, so there's no team view.

### 3.19 Reference data synced but unused

`organisation.json` (Content & Co NZ Ltd, NZD), `branches.json` (2: C&C Global Limited 42709, Content & Co NZ Ltd 37900), `roles.json` (21), `rate_cards.json` (Standard NZD, USD Rate Card; **names only, no rates**). `index.html` reads none of these. Jobs: 2,653 on branch Content & Co NZ Ltd, 79 on C&C Global Limited. Companies and invoices are all C&C Global Limited.

---

## 4. Durability matrix: what actually survives

`saveData()` (3399) → `persistNativeData()` (3422) serialises **only** these from `jobs`:
- whole jobs with `_local` → `cc_native_jobs`
- for every other job, an overlay entry in `cc_job_overlay[jobId]` = `{native, paused (if _manualPaused or non-ST), milestones (_isNative only), expenses (whole array), phases (_local only), itemDeltas: {stPhaseId: [_local items]}, splitInvoices, activity}`
- `stLoggedTimes` entries with `_local` → `cc_native_time`

`applyNativeData()` (3458) re-applies all of that after each `_mapStJob` pass, re-inserts native jobs, and removes ids in `cc_deleted_jobs`. Overlay entries for jobs missing from the current `jobs.json` are kept (3441–3450). Nothing persists until `_stHydrated` is true (3423). So if `jobs.json` fails to load, **every native write in that session is silently dropped**.

**On natively created jobs (`_local`)** every field persists, because the whole object is saved.

**On ST-backed jobs:**

| Edit | Function | Survives the 5-min poll / reload? |
|---|---|---|
| Name, start/due date, status, starred | `dbUpdateJob` via `editJobNameField` 9142, `saveJobDates` 9178, `editJobStatusField` 9189, `toggleStarJob` 7258, `archiveJob` 7267 | **Yes** (`_native`) |
| Pause | `saveJobSettings` 7214, `_cmdPauseJob` 10557 | **Yes** (`_manualPaused`) |
| Milestones, expenses, split invoices, activity | various | **Yes** |
| Phase via modal / item via modal | `dbCreatePhase`, `dbCreateItem` | **Yes** |
| Delete job | `deleteJobConfirm` 7274 | **Yes** (tombstone) |
| Phase via "New Phase" button / item via plan row | `addPhase` 8771, `saveItem` 8694 | **No** (not tagged `_local`) |
| Edit/complete/note/delete ST items; rename/complete/pause/delete ST phases | `inlineEditItem`, `toggleItemStatus`, `saveItemNote`, `ctxDo`, `pctxDo` | **No** |
| Name/company/contact/billable/workflow/lead in Job settings | `saveJobSettings` 7214 | **No** (direct writes; only pause sticks) |
| Workflow stage | `confirmAdvanceWorkflow` 9129, `setQuoteStatus` 8361 | **No** |
| Labels | `_persistActiveLabels` 8395, `bulkLabelJobs` 6973 | **No** |
| Members | `toggleJobMember` 7088 | **No** |
| Notes | `_updateJobNotesNow` 7116 | **No** |
| Job-level quote/invoice fields | `cycleQuoteStatus`, `updateQuoteField`, `openInvoice`, `saveInvStatus*`, `doInvCtx` | **No** |
| Bulk archive | `bulkArchiveJobs` 6959 | **No** |
| Bulk delete | `bulkDeleteJobs` 6965 | **No** (no tombstone, so the jobs come back) |
| Duplicate an ST job | `duplicateJob` 7249 | **No** (the copy keeps `_streamtime`, has no `_local`, and is dropped) |

**Never persisted anywhere:** To Do board tasks (`todoData`), reallocated time (`applyReallocate` 7674 edits only the board task), itemised expense sub-lines (`_expSubEdits`), `invCounter`.

**Everything in §5 is per browser.** The only cross-user sharing is `platform_config.json`.

---

## 5. Every localStorage key

"Export" = included in `WORKSPACE_KEYS` (2745), the Settings → Data backup. "X-tab" = changes trigger a reload in other tabs (`_xtabKeys` 11821).

| Key | Holds | Read / written (line) | Export | X-tab |
|---|---|---|---|---|
| `cc_native_jobs` | Job[] fully native jobs | 3461 / 3451 | ✓ | ✓ |
| `cc_job_overlay` | `{jobId: {native, paused, milestones, expenses, phases, itemDeltas, splitInvoices, activity}}` | 3447, 3460 / 3452 | ✓ | ✓ |
| `cc_native_time` | native time entries | 3811 / 3453, 3816 | ✓ | ✓ |
| `cc_deleted_jobs` | string[] deleted ST job ids (tombstones) | 3478 / 7281 | **✗** | ✗ |
| `cc_local_quotes` | native quotes | 3493 / 3494 | ✓ | ✓ |
| `cc_quote_versions` | `{quoteId: [{date, valueExTax, note}]}` | 11407 / 11411 | **✗** | ✗ |
| `cc_quote_opts` | `{jobId: {show*: bool}}` quote document toggles | 7699 / 7706 | ✗ | ✗ |
| `cc_clients` | Client[] (ST-derived + native, see §3.9) | 9580 / 9581 | ✓ | ✓ |
| `cc_people` | people map (§3.11) | 2731 / 2740 | ✓ | ✓ |
| `cc_person_status` | `{personKey: status}` | 3387 / 2741 | ✓ | ✗ |
| `cc_boards` | Board[] | 12433 / 12469, 12466 | ✓ | ✓ |
| `cc_labels` | `[{name, color}]` | 2708 / 2709 | ✓ | ✗ |
| `cc_line_items` | string[] item names | 2513 / 10418, 10439 | ✓ | ✗ |
| `cc_expense_items` | string[] expense names | 2515 / 10419, 10440 | ✓ | ✗ |
| `cc_ws_settings` | `{defaultCostRate, paymentTerms}` | 3496 / 3499 | **✗** | ✗ |
| `cc_config_published_at` | ISO timestamp of last config publish | 10196 / 10403 | ✓ | ✗ |
| `cc_gh_token` | **GitHub personal access token (secret)** with contents:write on the repo | 3848, 10207, 10370 / 10365 | ✗ | ✗ |
| `cc_happiness` | mood log (§3.18) | 4222 / 4223 | **✗** | ✗ |
| `cc_starred` | starred items | 2695 / 2696 | **✗** | ✗ |
| `cc_hidden_uninvoiced` | job ids hidden from the Uninvoiced report | 11137 / 11138 | ✗ | ✗ |
| `cc_jobs_filters`, `cc_qt_filters`, `cc_inv_filters` | active filter chips | 11155–11157 / 11177–11179 | ✗ | ✗ |
| `cc_jobs_groupby`, `cc_qt_groupby`, `cc_inv_groupby` | group-by choice | 11158–11160 / 11177–11179 | ✗ | ✗ |
| `cc_jobs_presets`, `cc_qt_presets`, `cc_inv_presets` | saved filter presets `[{id, name, filters, groupBy}]` | 11161–11163 / 11216, 11234 | ✗ | ✗ |
| `cc_hidecols_<jobs\|inv\|qt>` | hidden table columns | 6736 / 6746 | ✗ | ✗ |
| `cc_card_settings` | To Do card display toggles `[{key, label, on}]` | 6433 / 6438 | ✗ | ✗ |
| `cc_sched_people` | person keys shown on Schedule | 4300 / 4305 | ✗ | ✗ |
| `cc_recent_jobs` | last 5 job ids in the task job picker | 5757 / 5759 | ✗ | ✗ |
| `cc_recent` | recent items (`_trackRecent` 2689; no callers, dead) | 2690 / 2693 | ✗ | ✗ |
| `cc_rollover_seen` | Monday date the rollover prompt was shown | 6512 / 6526 | ✗ | ✗ |
| `cc_seen_version` | last changelog version shown | 6504 / 6555 | ✗ | ✗ |
| `cc_theme` | `'dark'\|'light'` | 2586 / 2591 | ✗ | ✗ |
| `cc_bg_image` | wallpaper JPEG data URL (≤2.5 MB) | 2602, 10015 / 2619 | ✗ | ✗ |
| `cc_last_sync` | read by Settings → Data (10226), **never written**, so it always shows "Unknown" | 10226 / — | ✗ | ✗ |
| `cc_jobs` | written once by `fixDuplicateJobIds` (3893), **never read** (legacy) | — / 3893 | ✗ | ✗ |
| `cc_todo` | legacy board store, **deleted on every load** (3484) | — | ✗ | ✗ |

Keys that hold business data but are **missing from the workspace export**: `cc_deleted_jobs`, `cc_quote_versions`, `cc_quote_opts`, `cc_ws_settings`, `cc_happiness`, `cc_starred`, `cc_hidden_uninvoiced`. Any harvesting step has to read them directly (SYNC_AND_MIGRATION.md §5).

---

## 6. Data-quality issues observed in the 8 Nov 2026 export

| # | Issue | Evidence | Impact |
|---|---|---|---|
| 1 | Logged time gap from w/c 28 Sep 2026 | weekly hours: ~500 h/week through Sep, then 281, 57, 49, 50, 31, 56 | Fix written (v2.38.1) but **not deployed**. Every time-based number since October is under-counted |
| 2 | Logged time starts 2025-07-08 | min `date` in logged_times.json | History before then exists only in ST |
| 3 | 1,345 archived jobs have no `phases`/`looseItems` | jobs.json; `sync_progress.json` nonetheless lists 2,742 jobs as "detail done" | The sync never re-fetches them (SYNC_AND_MIGRATION.md §2) |
| 4 | Duplicate job numbers `4474`, `4483`, `4438`; 48 null numbers; one `"N/A"` | jobs.json | Internal id collisions (`jobs.find` returns the first). The overlay is keyed by number |
| 5 | Invoices: 83 records (C&C Global Limited, Feb–Oct 2026) vs 2,162 jobs with issued invoices | invoices.json vs jobs.json | Invoice history is effectively missing |
| 6 | Quotes only from 2026-04-14; expenses only from 2025-12-22 | quotes.json, expenses.json | Same: partial history |
| 7 | `costRate` 0 for 36/37 users; `totalCostExTax` 0 on all time | users.json, logged_times.json | No real cost data in ST |
| 8 | No phase status field | job_phases payload | ST phase status can't be read |
| 9 | 2 logged-time jobs missing from jobs.json; 10 deleted companies missing from companies.json | cross-reference | Orphan references |
| 10 | Entries deleted in ST are never removed from logged_times.json | union-merge in the sweep (`logged_times_sweep.py:98`) | Over-counting after ST-side deletes |
| 11 | Client and label links are by name | §3.9, §3.16 | Renames break links |
