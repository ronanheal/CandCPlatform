# Backend API contract

*The API the backend must provide so the existing front end can drop Streamtime (ST) and `localStorage`. It's derived from the `db*` stubs **and** every other mutation path in `index.html` (commit `b6f7efb`; search by function name if lines have moved). Endpoint names and payloads are proposals. The function lists are the facts.*

---

## 0. Ground rules for the design

1. **The `db*` stubs are only part of the seam.** Nine exist (`index.html:2631–2688`), and `dbCreateJob` has **no callers**: jobs are created by `createJob` (9214). Around 90 other functions mutate objects directly and then call `saveData()`, `saveClientsData()`, `savePeople()`, `saveBoardsData()`, `saveGlobalLabels()`, `saveLocalQuotes()`, `setWorkspaceSetting()` or `localStorage.setItem` directly. Every one of them is listed below, and each needs an API call.
2. **Reads today are 11 whole-file downloads** (`initStreamtime`, 3714–3727) repeated every 5 minutes (11807). Two read strategies are proposed in §1. Pick one deliberately.
3. **Shapes.** Unless stated otherwise, request and response bodies use the internal shapes in DATA_MODEL.md §3. For read-only ST-shaped entities (logged time, invoices, quotes, expenses, assignments, contacts), return the **same field names** the app reads today (DATA_MODEL.md §3.4–3.12), or the render code breaks.
4. **Numbers, not display strings.** Items currently store `hours:"2h30m"`, `rate:"$150"`, `total:"$1,500"`. Store `plannedMinutes`, `sellRate` and so on as numbers, and either return both forms during the transition or add a small adapter in the front end.
5. **Identity.** There's no auth. `MY_PERSON` and `currentPerson` are hard-coded to `st_114330` (2771–2772), and almost every activity entry uses `MY_PERSON`. The backend must authenticate users and supply "me". The server should stamp `personKey` and timestamps on activity, time entries and so on, rather than trusting the client.
6. **Concurrency.** Data becomes shared between users for the first time. Use `updatedAt`/ETag with `If-Match` on PATCH. Today the last writer wins inside one browser, and other users never see the writes at all.
7. **Activity.** Most job mutations also call `logActivity(jobId, personKey, action, detailHTML)` (9256). Either expose `POST /jobs/:id/activity` and keep the client calls, or have the server append activity as a side effect of each mutation (recommended), and accept that `detail` is stored HTML today.
8. **Server-owned numbering.** Job numbers (`nextJobNumber` 3876, floor 6953), invoice numbers (`invCounter` 2726, which **resets to 1001 every session**) and native quote numbers (`'Q-'+Date.now()` tail, 9072) must be allocated by the server.

Suggested conventions: JSON over HTTPS, `/api/v1`, cookie or bearer auth, `400` with `{error, field}` on validation failures, and soft delete (`deletedAt`) for jobs, so ST-tombstone behaviour (`cc_deleted_jobs`) can be reproduced.

---

## 1. Reads

### Option A: drop-in file compatibility (recommended for the mirror phase)

Serve the same 11 resources with the same shapes the data branch has today, behind auth, and change only `ST_BASE` (3487) plus the fetch headers. The mapping code (`_mapStJob`, `_mapStCompany`, `seedWeekFromST`) stays as it is. Native data still overlays on the client until the write endpoints in §2 land.

| Endpoint | Replaces | Consumed by |
|---|---|---|
| `GET /api/v1/export/jobs.json` | `jobs.json` (ST view 7 + nested `phases[].items[]`, `looseItems[]`) | `_mapStJob` 3619 |
| `GET /api/v1/export/logged_times.json` | `logged_times.json` (slim shape, see `logged_times_sweep.py:43`) | `_getStWeekEntries` 3510, Time view 10944, Progress 7549, Reporting |
| `GET /api/v1/export/scheduled_todos.json` | `scheduled_todos.json` | `_getStWeekAssignments` 3572 |
| `GET /api/v1/export/job_assignments.json` | `job_assignments.json` | `_completedAssignmentLookup` 3563 |
| `GET /api/v1/export/invoices.json`, `quotes.json`, `expenses.json`, `milestones.json`, `companies.json`, `contacts.json`, `users.json` | same | see DATA_MODEL.md §1 |
| `GET /api/v1/export/sync_status.json` | `logged_times_sweep.json` / `sync_meta.json` | To Do "data through…" indicator (`stSweepState`) |
| `GET /api/v1/config` | `platform_config.json` | 3844 |

Add **date-window parameters** to logged time (`?from=&to=`) as soon as possible. The full file is 53 MB in production today.

### Option B: native resources (the Phase 3 target)

Return internal shapes directly, delete `_mapStJob` and the ST fetch layer (ROADMAP Phase 3), and compute the aggregates that ST computes today **on the server**:

| Endpoint | Returns | Server must compute |
|---|---|---|
| `GET /api/v1/jobs?status=&updatedSince=` | Job[] incl. phases/items/milestones/expenses/splitInvoices (activity paged separately) | `_loggedMins, _plannedMins, _sellUsed, _plannedSell, _finalBudget, _expUsed, _stInvoiced, _stPaid, _stAwaitingPayment` (today `totalLoggedMinutes`, `totalLoggedTimeExTax`, `totalIssuedInvoicesExTax` etc. come from ST, see DATA_MODEL.md §3.1) |
| `GET /api/v1/time-entries?from=&to=&userId=&jobId=` | TimeEntry[] | — |
| `GET /api/v1/todos?weekStart=&userId=` | Task[] for the To Do board | done-state rules now in `seedWeekFromST` 3907 |
| `GET /api/v1/invoices`, `/quotes`, `/expenses`, `/clients`, `/contacts`, `/people`, `/boards`, `/labels`, `/settings` | | |
| `GET /api/v1/me` | `{personKey, name, role, preferences}` | replaces `MY_PERSON` |

Use `updatedSince` (or SSE/websocket) to replace the 5-minute full refetch (11807) and the same-browser `storage` event reload (11822).

---

## 2. Writes, by entity

Format: **endpoint**, then request and response, then the `index.html` callers today. "(stub)" marks an existing `db*` function.

### 2.1 Jobs

| Endpoint | Request → Response | Called from today |
|---|---|---|
| `POST /api/v1/jobs` | `{name, company, billable, workflowStatus:'quote'\|'live'\|'invoiced', number?}` → Job (server assigns `number`, `status:'new'`, `members:[me]`) | `createJob` 9214. `dbCreateJob` 2632 (stub, **unused**). Job number pre-filled by `openCreateJob` 9039 → `nextJobNumber` 3876 |
| `PATCH /api/v1/jobs/:id` | any of `{name, startDate, dueDate, status, starred, paused, company, contact, billable, workflowStatus, lead, notes, labels[], quoteStatus, quoteNum, issueDate, poNum}` → Job | `dbUpdateJob` 2636 (stub) ← `editJobNameField` 9142, `saveJobDates` 9178, `editJobStatusField` 9189, `toggleStarJob` 7258, `archiveJob` 7267, `unstarJobFromPanel` 10682. **Direct writes that must also call it:** `saveJobSettings` 7214 (name/company/contact/billable/paused/workflowStatus/lead), `_cmdPauseJob` 10557, `confirmAdvanceWorkflow` 9129, `_updateJobNotesNow` 7116 (debounce, it fires on every keystroke), `_persistActiveLabels` 8395, `cycleQuoteStatus` 8354, `setQuoteStatus` 8361 (also moves workflow to `live` on approval), `sendQuote` 8375, `updateQuoteField` 8350, `renderQuoteTab` 8149–8150 (sets `quoteNum`/`issueDate` **on render**, which should become server defaults) |
| `DELETE /api/v1/jobs/:id` | → 204 (soft delete) | `deleteJobConfirm` 7274 (writes the `cc_deleted_jobs` tombstone for ST jobs), `bulkDeleteJobs` 6965 (no tombstone today) |
| `POST /api/v1/jobs/bulk` | `{ids[], action:'archive'\|'addLabel'\|'delete', label?}` → `{updated:n}` | `bulkArchiveJobs` 6959, `bulkLabelJobs` 6973, `bulkDeleteJobs` 6965 |
| `POST /api/v1/jobs/:id/duplicate` | → Job (new number, name + " (Copy)", activity cleared, `invNum` null) | `duplicateJob` 7249 |
| `PUT /api/v1/jobs/:id/members` | `{members: personKey[]}` → Job | `toggleJobMember` 7088. `deletePerson` 10488 strips a person from all jobs |

### 2.2 Activity and attachments

| Endpoint | Request → Response | Called from |
|---|---|---|
| `GET /api/v1/jobs/:id/activity?before=` | → `{ts, personKey, action, detail, img?}[]` | `renderActivityTab` 9308 |
| `POST /api/v1/jobs/:id/activity` | `{action:'comment', detail}` → entry | `addActivityComment` 9265, plus ~40 internal `logActivity` 9256 calls (or make them server-side) |
| `POST /api/v1/jobs/:id/attachments` | multipart file → `{id, url, name, mime}` and an activity entry | `_activityFileDrop` 9275 (today it downscales images to a ≤720 px JPEG data URL stored **inside** activity, and records non-images by name only) |

### 2.3 Phases

| Endpoint | Request → Response | Called from |
|---|---|---|
| `POST /api/v1/jobs/:jobId/phases` | `{name, status:'open'}` → Phase | `dbCreatePhase` 2650 (stub) ← `submitNewPhase` 4653. **Also** `addPhase` 8771 ("New Phase" button, which bypasses the stub) |
| `PATCH /api/v1/phases/:id` | `{name?, status?:'open'\|'complete', paused?, order?}` → Phase | `pctxDo` 8802 (rename / complete / pause) |
| `DELETE /api/v1/phases/:id` | → 204. Undo needs either a restore endpoint or a re-create with the same items | `pctxDo` 8802 (`delete` plus `_undoPhaseDelete`) |

### 2.4 Items (job-plan lines)

| Endpoint | Request → Response | Called from |
|---|---|---|
| `POST /api/v1/phases/:phaseId/items` | `{name, plannedMinutes, sellRate, description?}` → Item | `dbCreateItem` 2656 (stub) ← `submitNewItem` 4680. **Also** `saveItem` 8694 (inline add row, bypasses the stub) |
| `PATCH /api/v1/items/:id` | `{name?, plannedMinutes?, sellRate?, status?:'open'\|'inprogress'\|'complete', note?}` → Item (server recomputes totals) | `inlineEditItem` 8619, `toggleItemStatus` 8675, `saveItemNote` 8654 |
| `DELETE /api/v1/items/:id` | → 204 | `ctxDo` 8773 (`delete`) |

### 2.5 Time entries (logged time)

| Endpoint | Request → Response | Called from |
|---|---|---|
| `POST /api/v1/time-entries` | `{jobId, itemId?, date, minutes, notes, userId?(default me)}` → TimeEntry in the logged-time shape (`job:{id,number,name,isBillable}`, `jobItemUser:{jobItemId}`) | `dbCreateTimeEntry` 2646 (stub) ← `_logTimeFromFup` 6286 (hours prompt after mark-done; **refuses native jobs**, 6296), `_cmdLogTime` 10546 (⌘K "log 2h on 6797") |
| `PATCH /api/v1/time-entries/:id` | `{jobId?, itemId?, minutes?, notes?, date?}` | `applyReallocate` 7674 (today it re-points only the in-memory board card, which isn't durable and doesn't touch the time entry) |
| `DELETE /api/v1/time-entries/:id` | → 204 | no UI today. Needed for corrections, and to replace ST-side deletes |

The server must also take over the dedupe that the client does on load (3806–3818): once ST is retired, native entries are the only copy.

### 2.6 To Do board tasks (scheduled todos)

**There's no persistence today.** Every function here mutates the in-memory `todoData`, and the next 5-minute poll wipes it (`resetTodoStore` 3944, called at 3861). Under the API each becomes a call. Proposed resource: `Task = {id, personKey, date, minutes, title, jobId?, itemId?, urgent, personal, done, repeatGroup?, note?}`, keyed by **date**, not week+day.

| Endpoint | Called from |
|---|---|
| `GET /api/v1/todos?userId=&weekStart=` | `getWeekData` 3933 / `seedWeekFromST` 3907 |
| `POST /api/v1/todos` (with `repeat:{until\|count}` to fan out server-side) | `saveTodo` 6655 (new), `createTaskCard` 5430, `duplicateTask` 5617, `_cmdQuickTodo` 10567, `_spawnRepeatOccurrences` 6623, `_schedStripDrop` 7743 (drag a job-plan item onto a day) |
| `PATCH /api/v1/todos/:id` | `saveTodo` 6655 (edit/reassign), `reassignTask` 5634, `_calResizeEnd` 4957 (minutes), `calDropToDay` 4982 / `onDropToSection` 5688 (date/order), `_taskDockWeek` 7788 (±1 week), `_taskDockPerson` 7796 (reassign), `toggleTaskDone` 6212 / `calDropToDrawer` 5019 / `_focusToggleDone` 10775 (done), `applyReallocate` 7674, `checkRolloverPrompt` 6518 (bulk move unfinished to this week) |
| `POST /api/v1/todos/:id/split` `{dates:[d1,d2]}` | `_splitTaskAcross` 7868 |
| `DELETE /api/v1/todos/:id` | `deleteTodoById` 5625, `deleteTodo` 6172 |

Marking a task done can create a time entry (`_showFupForTask` 6237 → `_logTimeFromFup` 6286). Keep that as two calls, or make `PATCH {done:true, logMinutes}` atomic.

### 2.7 Assignments (job item ↔ user)

No write path exists today (read-only from ST view 17). If the item-completion signal is to survive ST, expose `PATCH /api/v1/assignments/:id {status:'complete', completedDate}`, or derive completion from item status plus time entries. **Product decision needed.**

### 2.8 Expenses

| Endpoint | Request → Response | Called from |
|---|---|---|
| `POST /api/v1/jobs/:jobId/expenses` | `{desc, date, cost, markupPct?, sell?, qty?, supplier?}` → Expense `{…, sell, total, status:'draft'}` | `dbCreateExpense` 2662 (stub) ← `submitLogExpense` 4626. **Also** `saveExpense` 8880 and `saveExpenseInline` 8753, which bypass the stub with a different shape (`markup`, `qty`, `total`) |
| `PATCH /api/v1/expenses/:id` | `{desc?, status?:'draft'\|'approved'\|'invoiced', qty?, cost?, markupPct?, date?}` | `saveExpenseDetail` 4575, `cycleExpenseStatus` 9031 |
| `PUT /api/v1/expenses/:id/lines` | `[{label, amount}]` | `_setExpSub` 8933, `_addExpSub` 8940, `_removeExpSub` 8941, `_addExpDetailSub`, `_removeExpDetailSub` (itemised sub-lines; **in memory only** today, and they also apply to ST expenses) |
| `DELETE /api/v1/expenses/:id` | → 204 | `deleteExpenseDetail` 4592 |

### 2.9 Milestones

| Endpoint | Called from |
|---|---|
| `POST /api/v1/jobs/:jobId/milestones` `{name, date}` → `{id, name, date}` | `dbCreateMilestone` 2672 (stub) ← `saveMilestoneInline` 8042 |
| `PATCH /api/v1/milestones/:id` `{name?, date?}` | `dbUpdateMilestone` 2678 (stub) ← inline `commit` 8065 |
| `DELETE /api/v1/milestones/:id` | `dbDeleteMilestone` 2683 (stub) ← `deleteMilestoneRow` 8074 |

### 2.10 Quotes

Today there are three quote concepts (DATA_MODEL.md §3.8). **Recommendation:** make one `Quote` entity linked to a job, and turn the job-level `quoteStatus`/`quoteNum`/`poNum` into fields on that job's current quote.

| Endpoint | Request → Response | Called from |
|---|---|---|
| `POST /api/v1/quotes` | `{quoteName, company, jobId?, quoteDate, totalAmountExTax, notes}` → Quote (server assigns `quoteNumber`, computes inc-tax) | `saveNewQuote` 9061 |
| `PATCH /api/v1/quotes/:id` | `{quoteStatus?, sentDate?, approvedDate?, …}` | none for ST/native quote records today. The job-level equivalents are `cycleQuoteStatus` 8354, `setQuoteStatus` 8361, `sendQuote` 8375, `updateQuoteField` 8350 (see 2.1) |
| `POST /api/v1/quotes/:id/versions` | `{valueExTax, note}` → `{date, valueExTax, note}` | `saveQtVersion` 11432 |
| `DELETE /api/v1/quotes/:id/versions/:n` | | `deleteQtVersion` 11442 |
| `PUT /api/v1/jobs/:jobId/quote-options` | `{showJobNum, showQuoteNum, showDescriptions, showQty, showUnitRate, showSubtotals, showTax, showTCs}` | `_setQuoteOpt` 7702 |

There's no delete or edit for native quotes in the UI today.

### 2.11 Invoices

| Endpoint | Request → Response | Called from |
|---|---|---|
| `POST /api/v1/jobs/:jobId/invoice` | `{}` → `{invNum, invIssueDate, invDueDate (issue + paymentTerms), invStatus:'draft'}`. Idempotent: returns the existing invoice if there is one | `openInvoice` 9394, `doInvCtx('view')` 11582, `openInvoiceForJob` 11771 (dead per ROADMAP), uninvoiced-row drop dock (`_invDockDrop` 7836) |
| `PATCH /api/v1/jobs/:jobId/invoice` | `{invStatus:'draft'\|'sent'\|'paid'\|'voided'}` → server sets `invTotal` (= planned sell) on first send/paid | `saveInvStatus` 9433, `saveInvStatusForJob` 11780, `doInvCtx('draft'\|'sent'\|'paid')` 11582 |
| `DELETE /api/v1/jobs/:jobId/invoice` | → 204 (clears `invNum`, `invStatus`, `invDueDate`, `invTotal`) | `doInvCtx('delete')` 11582 |
| `POST /api/v1/jobs/:jobId/split-invoices` | `{label, pct?, amount}` → `{id, label, pct, amount, status:'draft', date}` | `saveSplitInvoice` 9484 |
| `PATCH /api/v1/split-invoices/:id` | `{status}` | `cycleSplitInvoiceStatus` 9498 |
| `DELETE /api/v1/split-invoices/:id` | | `deleteSplitInvoice` 9505 |
| `POST /api/v1/invoices/:id/xero` | → `{externalInvoiceId}` | **Not built.** Today `copyInvoiceToXero` 9564 copies a CSV to the clipboard. ST's own invoices already carry `externalInvoiceId` (Xero). This needs Xero write credentials (ROADMAP "Phase 2 still to build") |

### 2.12 Clients and contacts

| Endpoint | Request → Response | Called from |
|---|---|---|
| `POST /api/v1/clients` | `{name, nickname?, contact?, email?, phone?}` → Client | `saveNewClient` 9898. **Implicit creates:** `renderClients` 9583 auto-creates a stub for every job company without a record. On the server, that should be a lookup by name, not a write on render |
| `PATCH /api/v1/clients/:id` | `{nickname?, contact?, email?, phone?, lead?, group?, notes?}` | `updateClientField` 9853 (fires on every keystroke via `oninput`, so debounce) |
| `POST /api/v1/clients/:id/contacts` | `{name, role, email, phone}` → contact | `addClientContact` 9857 |
| `PATCH /api/v1/clients/:id/contacts/:cid` | | `updateLocalContact` 9867 (per keystroke) |
| `DELETE /api/v1/clients/:id/contacts/:cid` | | `deleteClientContact` 9863 |

There's no client delete or rename today. Jobs reference clients **by name**: move to `clientId` in the backend and keep returning `company` (the name) for the front end.

### 2.13 People

| Endpoint | Request → Response | Called from |
|---|---|---|
| `POST /api/v1/people` | `{name, role}` → Person | `saveNewPerson` 10468 |
| `PATCH /api/v1/people/:key` | `{name?, role?, color?, team?, hoursPerDay?, rate?, archived?, days?}` | `updatePerson` 10460, `toggleArchivePerson` 10482 |
| `DELETE /api/v1/people/:key` | → 204 (server strips from job members/lead) | `deletePerson` 10488 |
| `PUT /api/v1/people/:key/status` | `{status}` | `changePersonStatus` 6167 |

`addTeamMember` (6272) also writes people but is listed as dead in ROADMAP. ST users join People through `_stId`. After cutover, People is the user table and needs a login identity (email).

### 2.14 Boards

| Endpoint | Called from |
|---|---|
| `POST /api/v1/boards` `{name, type:'custom'\|'client'\|'people', clientFilter?, columns?}` | `saveNewBoard` 13052, `createStudioPreset` 13064, `_clientDockDrop` 7815 |
| `DELETE /api/v1/boards/:id` | `deleteBoard` 13061 |
| `PUT /api/v1/boards/:id/notes/:personKey` `{text}` | `savePboardNote` 12644 |
| `POST /api/v1/boards/:id/columns` `{name, type, clientFilter?, personFilter?}` | `confirmAddColumn` 12897, `renderCustomBoard` 12651 (default columns created on render) |
| `PATCH /api/v1/boards/:id/columns/:colId` `{name?, order?}` | `renameCol` 12840, `colDrop` 12965 (reorder) |
| `DELETE /api/v1/boards/:id/columns/:colId` | `deleteCol` 12844 (inner `_doDelete`) |
| `POST /api/v1/boards/:id/columns/:colId/cards` `{type, jobRef?\|clientRef?\|personRef?\|note?}` | `_doAddCard` 12829 |
| `PATCH /api/v1/cards/:id` `{note?, columnId?, beforeCardId?}` | `saveCustomCardNote` 12939, `cardColDrop` 13009 |
| `DELETE /api/v1/cards/:id` | `deleteCard` 12927 |

A simpler alternative that matches the current code: `PUT /api/v1/boards/:id` with the whole board document on every change, which is what `saveBoardsData` (12469) effectively does. Add an ETag.

### 2.15 Labels, catalogues and workspace settings

| Endpoint | Called from |
|---|---|
| `POST /api/v1/labels` `{name, color?}` | `addGlobalLabel` 2710 (also called implicitly for every job label on load, 3780, and from `bulkLabelJobs`) |
| `PATCH /api/v1/labels/:name` `{color}` | `cycleLabelColor` 10432 |
| `DELETE /api/v1/labels/:name` | `removeGlobalLabel` 10428 |
| `PUT /api/v1/catalogues/line-items` / `expense-items` `string[]` | `addSettItem` 10414, `removeSettItem` 10438 |
| `PATCH /api/v1/settings` `{defaultCostRate?, paymentTerms?}` | `setWorkspaceSetting` 3499 ← Workspace Defaults card (≈10129, 10136) |
| *(remove)* | `publishConfig` 10370 and `saveGhToken` 10363 commit `platform_config.json` with a browser-held GitHub PAT. Once people, labels and catalogues come from the API, delete this flow and the `cc_gh_token` key |

### 2.16 Per-user preferences and small stores

One document per user is enough: `GET/PATCH /api/v1/me/preferences`.

| Preference | Today (key, function) |
|---|---|
| theme, wallpaper | `cc_theme` `toggleTheme` 2588. `cc_bg_image` `setBgImage` 2607 (a data URL up to 2.5 MB, so use the attachments endpoint) |
| dashboard teams/blocks | `people[MY_PERSON].dashTeams/dashHide` via `toggleDashTeam` 10443, `toggleDashBlock` 10451 (stored on the shared person record today) |
| card settings | `cc_card_settings` `saveCardSettings` 6438 |
| filters, group-by, presets | `cc_*_filters/groupby/presets` `_saveFilterState` 11175, `saveFilterPreset` 11211, `deleteFilterPreset` 11229 |
| hidden columns | `cc_hidecols_*` `toggleCol` 6742 |
| schedule people | `cc_sched_people` `_setScheduleSelectedPeople` 4305 |
| recent jobs | `cc_recent_jobs` `_pushRecentJob` 5758 |
| starred items | `cc_starred` `toggleStarItem` 2697 (could be its own `PUT/DELETE /api/v1/me/stars/:type/:id`) |
| hidden uninvoiced jobs | `cc_hidden_uninvoiced` `hideUninvoicedJob` 11139 (team-wide or per user? **decide**) |
| rollover / changelog seen | `cc_rollover_seen` 6526, `cc_seen_version` 6555 |

### 2.17 Mood check-in

`POST /api/v1/mood {weekStart, score:1–5|null, note?, skipped?}`: `submitHappiness` 4266, `skipHappinessWeek` 4258. The code comment at 4214–4221 explains a team report was deliberately not built because the data was device-local. A backend removes that blocker.

### 2.18 Workspace export / import

`exportWorkspace` 2746 and `importWorkspace` 2755 become unnecessary once the server holds the data. **Keep them until cutover:** they're the harvesting tool for native data (SYNC_AND_MIGRATION.md §5). Note that `WORKSPACE_KEYS` (2745) leaves out seven business-data keys (DATA_MODEL.md §5).

---

## 3. Not built yet, but will need the backend

- **@mentions and notifications** (ROADMAP: needs a realtime backend).
- **Role and permission gate** (ROADMAP "Deferred": client-side gates are bypassable). Today every visitor can see and edit everything, including rates and invoices.
- **Time approval** (ST export has no approval fields, so it'd be a new feature).
- **Xero push** for natively created invoices.
- **File storage** for activity attachments and the wallpaper.

## 4. Swap checklist for the front end (per endpoint)

1. Replace the stub or direct write with `await api(...)`. Update in-memory state from the **response**, not the request.
2. Drop the matching `_local` / `_native` / overlay handling once the entity is fully server-backed: `persistNativeData` 3422, `applyNativeData` 3458, and the native-time re-append at 3806–3818.
3. Remove the `localStorage` key from `WORKSPACE_KEYS` (2745) and `_xtabKeys` (11821).
4. When the last ST read is gone, delete `initStreamtime` 3704, `_mapStJob` 3619, `_mapStCompany` 3691, `ST_BASE` 3487 and the 5-minute poll 11807 (replace with `updatedSince` or push), then the ~20 dead functions noted in ROADMAP ("Phase 3 pre-flight").
