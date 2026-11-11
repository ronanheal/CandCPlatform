# C&C Platform — bug audit, November 2026

Audited ahead of internal user testing (Dec 2026) and the handover to Razor.

- **Code:** `index.html` as of commit `7399d25` plus the working tree on 2026-11-09 (13,250 lines). Line numbers are for that version. `index.html` is being edited at the same time, so if a line number has drifted, search for the **function name** given with each finding.
- **Data:** `origin/streamtime-data` fast sync of 2026-11-08T20:10Z (2,732 jobs, 15,555 logged times, 83 invoices, 89 quotes, 266 expenses, 37 users). Every field name below was checked against these files.
- **Timezone:** date maths was re-run under `TZ=Pacific/Auckland` (node) wherever a finding depends on it.
- **Known gap left out:** `logged_times.json` is missing most data since October (a sync fix is pending), so low October/November hours are **not** reported as a bug. Note that two findings below (M1, H1's double-counting) will get *more* visible once that data comes back.

**Counts:** 5 High · 14 Medium · 14 Low · 4 Unverified

---

## High

### H1 — Marking a task done logs its hours as new time, even when you click "No thanks"
- **Where:** `_showFupForTask` (6338, prefill at 6348), `closeFup` (6417), `_logTimeFromFup` (6391), `dbCreateTimeEntry` (2723)
- **What the user sees:** You tick a Streamtime task done, or drag it to Done, and the "Follow-up?" card pops up. **Either** button ("Yes, add one" or "No thanks") logs a new time entry. Then the board re-seeds:
  - the card you just ticked jumps back into **To Do**;
  - a second "Done" card shows up, on **yesterday's** column if it's before 1pm. On a Monday morning it lands on Sunday, so it doesn't show at all;
  - every other unsaved board edit is wiped (see H2).

  The entry is also saved to `cc_native_time` for good. When the real log later arrives from Streamtime, the dedupe often misses it (different date or minutes), so Progress, Profitability and Reporting count those hours **twice**.
- **Trigger:** On the To Do board, mark any task on a Streamtime-backed job as done, then click "No thanks".
- **Root cause:**
  1. `_showFupForTask` fills `#fup-hrs` with the task's hours, and `closeFup(yes)` calls `_logTimeFromFup()` whether `yes` is true or false. So a filled-in field always gets logged.
  2. `_logTimeFromFup` sets `date:new Date().toISOString().slice(0,10)`, which is the **UTC** date. In NZ that's yesterday until 1pm (NZDT). `dbCreateTimeEntry` defaults to the same UTC date.
  3. The new entry has no `jobItemUser`, so `seedWeekFromST` can't pair it with the scheduled block (`_stItemId` comes from `lt.jobItemUser?.jobItemId`).
  4. `dbCreateTimeEntry` calls `resetTodoStore()`.
- **Fix:**
  ```js
  // closeFup: only log when the user explicitly chose to
  function closeFup(yes){ document.getElementById('fup').classList.remove('on'); if(yes) _logTimeFromFup(); ... }
  // or leave #fup-hrs empty by default and log only if the user types hours.

  // one shared local-date helper, used everywhere "today" is a YYYY-MM-DD string
  const _localISO=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  // _logTimeFromFup
  await dbCreateTimeEntry({ ..., date:_localISO(),
    jobItemUser: t._stItemId ? {jobItemId:t._stItemId} : null });

  // dbCreateTimeEntry: no resetTodoStore(); default date:_localISO()
  ```

### H2 — To Do board edits disappear every 5 minutes, and straight away whenever time is logged
- **Where:** `initStreamtime` → `resetTodoStore()` (3938); the 5-minute poll (11925); `dbCreateTimeEntry` (2725); `_cmdLogTime` (10664)
- **What the user sees:** Things a tester does on the board disappear while they work, without a page reload:
  - tasks they added (including repeats);
  - ticks and moves between days;
  - resizes, reassignments, splits and deletes.

  This happens on the next background poll (at most 5 minutes later), and right away after "log hours" (H1) or `⌘K log 2h on 1234`. Repeats and reassigned tasks vanish the same way. Native tasks have no "this is temporary" warning (only Streamtime tasks do, in `editTask`).
- **Trigger:** Add a task with "+ Add task", stay on the To Do view with no modal open, and wait up to 5 minutes. The task is gone.
- **Root cause:** By design, `todoData` lives only in memory ("revert on refresh"). The 5-minute poll added later calls `initStreamtime(true)`, which runs `resetTodoStore()` with no conditions. `dbCreateTimeEntry` also resets the store. So "revert on refresh" became "revert every 5 minutes".
- **Fix:** Keep the board's local changes in a small persisted overlay and apply it in `seedWeekFromST`. At minimum, don't reset on silent polls.
  ```js
  // persisted: { native:{[person]:{[weekKey]:{[day]:[task]}}}, over:{[taskId]:{done,day,hours,person,deleted}} }
  // seedWeekFromST(person,offset): build from ST as now, then apply over[*] and append native[person][weekKey]
  // initStreamtime: if(!silent) resetTodoStore(); else todoData = {}  // re-seed WITH the overlay applied
  ```

### H3 — Job-detail edits on Streamtime jobs undo themselves within 5 minutes or on reload
- **Where:**
  - `_updateJobNotesNow` (7234)
  - `_persistActiveLabels` (8513)
  - `toggleJobMember` (7206)
  - `saveJobSettings` (7332)
  - `confirmAdvanceWorkflow` (9247)
  - `setQuoteStatus` / `cycleQuoteStatus` / `sendQuote` (8472–8493)
  - `saveInvStatus` / `saveInvStatusForJob` (9551 / 11898)
  - `updateQuoteField` (PO on the quote doc)
- **What the user sees:** You type a brief or notes, add labels, add team members, change Job Settings (name, company, contact, billable, workflow stage, lead), advance the workflow, or mark the quote approved or the invoice sent. It all looks saved, then quietly reverts on the next poll or reload. The Activity tab still says "Updated the job notes / brief" and "Moved to Completed", because activity *is* persisted. This affects ~all jobs, since all real jobs come from Streamtime.
- **Trigger:** Open any Streamtime job, type in the notes box, and reload. The notes are empty.
- **Root cause:** `_mapStJob` rebuilds every job from scratch (`notes:''`, labels from ST, and so on). `persistNativeData()` only keeps `_native` (written by `dbUpdateJob`), manual pause, milestones, expenses, phases/items, split invoices and activity. All of the handlers above write straight onto `j.*`, so their changes are never persisted. The single-job archive, star and inline name/date/status edits were already moved to `dbUpdateJob`; these were missed.
- **Fix:** Send the changes through `dbUpdateJob`, which records them in `j._native`. `applyNativeData` already re-applies them with `Object.assign`.
  ```js
  function _updateJobNotesNow(val){ if(activeJobId) dbUpdateJob(activeJobId,{notes:val}); }
  function _persistActiveLabels(){ if(activeJobId) dbUpdateJob(activeJobId,{labels:[...activeLabels]}); }
  // toggleJobMember: dbUpdateJob(jobId,{members:[...j.members]})
  // saveJobSettings: dbUpdateJob(activeJobId,{name,company,contact,billable,workflowStatus,lead})
  // confirmAdvanceWorkflow / setQuoteStatus / saveInvStatus*: dbUpdateJob(id,{workflowStatus}) / {quoteStatus} / {invStatus,invTotal,...}
  ```
  Caveat for Razor: `_native` overrides Streamtime permanently, so a later rename made in Streamtime won't come through. Consider storing a timestamp and letting the newer value win.

### H4 — Bulk Archive / Delete / Label and "Duplicate job" don't stick
- **Where:** `bulkArchiveJobs` (7077), `bulkDeleteJobs` (7083), `bulkLabelJobs` (7091), `duplicateJob` (7367)
- **What the user sees:**
  - Jobs archived or labelled from the jobs-list bulk bar revert within 5 minutes.
  - Jobs bulk-deleted (after an "This can't be undone" confirm) come back.
  - "Duplicate job" on a Streamtime job creates "X (Copy)". The copy shows the **original's** logged time, invoices and quotes, then disappears on the next poll along with anything typed into it.
- **Trigger:** Tick two jobs, click Archive, and wait for the poll or reload.
- **Root cause:**
  - The bulk handlers set `j.status` or `j.labels` directly, and delete with `jobs.filter` but write no `cc_deleted_jobs` tombstone. The single-job versions `archiveJob` and `deleteJobConfirm` (7392) do it correctly.
  - `duplicateJob` deep-copies the job **including `_streamtime:true` and `_stId`**, and doesn't set `_local`. `persistNativeData` therefore never saves it, and every ST lookup keyed on `_stId` treats it as the original.
- **Fix:**
  ```js
  // bulkArchiveJobs
  ids.forEach(id=>dbUpdateJob(id,{status:'archived'}));
  // bulkDeleteJobs — reuse the tombstone logic from deleteJobConfirm for each id with _stId
  // bulkLabelJobs
  ids.forEach(id=>{const j=jobs.find(x=>x.id===id); if(j) dbUpdateJob(id,{labels:[...new Set([...(j.labels||[]),lbl])]});});
  // duplicateJob
  const copy=JSON.parse(JSON.stringify(j));
  delete copy._streamtime; delete copy._stId; delete copy._native;
  Object.keys(copy).filter(k=>/^_(st|logged|planned|sell|exp|hPct|bPct|finalBudget)/.test(k)).forEach(k=>delete copy[k]);
  Object.assign(copy,{id:newId,name:j.name+' (Copy)',activity:[],invNum:null,status:'new',_local:true,_createdAt:Date.now()});
  ```

### H5 — Every user is "Ronan": the current user is hard-coded
- **Where:** `const MY_PERSON='st_114330'` and `let currentPerson='st_114330'` (2848–2849); used in 74 places
- **What the user sees:** Every tester gets:
  - "Good morning, Ronan Heal" and Ronan's tasks on the Dashboard;
  - Ronan's To Do board by default, and "Add task" files tasks under Ronan;
  - `⌘K log …` and the H1 flow logging time as Ronan's Streamtime user id;
  - every Activity entry credited to Ronan;
  - Settings → My Profile editing Ronan's record (the published config then overwrites it anyway; see M11);
  - the happiness check-in and "Your day" for Ronan.

  This blocks multi-person testing.
- **Trigger:** Anyone opens the app.
- **Root cause:** No identity selection exists. The constant was left in from single-user development.
- **Fix:**
  ```js
  let MY_PERSON = localStorage.getItem('cc_me') || null;   // was const
  let currentPerson = MY_PERSON;
  // after users.json loads: if(!MY_PERSON || !people[MY_PERSON]) show a one-time "Who are you?" picker
  // listing active ST users (stUsersById[*].active), then localStorage.setItem('cc_me', key); location.reload();
  ```
  Also fix the `isOwnPublish` check (3925), which compares `people[MY_PERSON].name`.

---

## Medium

### M1 — Job Plan items count this week's Streamtime time twice
- **Where:** `renderItems` (8613), the logged-hours loop. Same data path as `_taskMatchesItem`.
- **What the user sees:** On the Job Plan, an item's "logged" hours and "sell used" include current-week Streamtime time **twice**. Items show red "over plan" too early. The number also changes depending on which weeks you've browsed on the To Do board. Items "completed in Streamtime without logging time" count their *scheduled* hours as logged.
- **Trigger:** Open the Dashboard (which seeds every person's current week), then open a live job whose items have time logged this week. (Small right now only because of the October data gap; it comes back with the sync fix.)
- **Root cause:** The loop adds (a) every `done` card in `todoData` that matches the job and item by name, and (b) every `stLoggedTimes` entry with `jobItemUser.jobItemId === item._stId`. The cards in (a) for Streamtime weeks *are* the entries in (b): `_getStWeekEntries` builds them with `item: lt.itemName` and `jobId: jNum`.
- **Fix:** Only count native cards from `todoData`.
  ```js
  (wd[d]||[]).forEach(tt=>{ if(tt._fromST) return; /* ST time comes from the stLoggedTimes loop below */ ... });
  ```

### M2 — "Reassign" from the right-click menu, and repeating tasks, wipe the target week
- **Where:** `reassignTask` (5735), `_spawnRepeatOccurrences` (6741)
- **What the user sees:**
  - Right-click a card, choose Reassign → Bianca, then open Bianca's board. That week shows **only** the reassigned task; all her Streamtime tasks for the week are missing.
  - Create a weekly repeating task, then go to next week. Only the repeat is there; that week's scheduled and logged work is gone.
- **Trigger:** Reassign while viewing next week (or any week the target person hasn't been seeded for, e.g. after a poll). Or create any repeating task.
- **Root cause:** Both functions create `todoData[person][weekKey] = {}` by hand. `getWeekData` only seeds from Streamtime when that key is *absent*, so the hand-made week is never seeded. The drag dock (`_taskDockPerson`) does this correctly through `getWeekData`.
- **Fix:**
  ```js
  // reassignTask
  const twd=getWeekData(toPersonKey,weekOffset); (twd[fromDay]=twd[fromDay]||[]).push(task);
  // _spawnRepeatOccurrences: compute the occurrence's week offset and use getWeekData(targetPerson, off)[futureDayN]
  ```

### M3 — Editing a task: changing the day does nothing, changing the date to another week drops the edit, changing the job keeps the old job
- **Where:** `saveTodo` (6773), edit branch; `miniCalSelectDate` (6096); `_taskJobId` (6333)
- **What the user sees:**
  1. Open a task, change **Day** from Tue to Thu, and save. It stays on Tuesday.
  2. Open a task and pick a date in a *different week* from the mini calendar. Saving does nothing (the title edit is lost too) and the board jumps to the other week.
  3. Change a native task's **Job** from A to B, then mark it done and log hours (H1). The time goes to **job A**.
- **Root cause:**
  1. When the person is unchanged, the edit branch only does `Object.assign(arr[idx], …)` and never moves the task to `dayNum`.
  2. `miniCalSelectDate` changes the *global* `weekOffset`. `saveTodo` then looks for the task in `getWeekData(currentPerson)` for the new week, gets `idx === -1`, and silently does nothing.
  3. The edit sets `job` but not `jobId`, and `_taskJobId` prefers `t.jobId`.
- **Fix:** In `editTask`, remember `_editOffset = weekOffset`. In `saveTodo`, take the task out of `getWeekData(currentPerson,_editOffset)[editingDay]`, update it with `jobId: jobId||null`, and push it to `getWeekData(targetPerson)[dayNum]`.

### M4 — Reporting → Business → "Deadlines" is one day off
- **Where:** `_renderBusinessReport`, `dueSoon` / `overdue` (12287–12288)
- **What the user sees:** A job due **today** shows "Due in 1d", one due tomorrow shows "Due in 2d", and a job that was due **yesterday** shows "Due in 0d" in orange instead of "Overdue 1d". (Checked with node in Pacific/Auckland.)
- **Root cause:** `new Date(j.dueDate)` on a `YYYY-MM-DD` string is parsed as UTC midnight, which is 13:00 in NZ. The same bug was fixed on the Dashboard in an earlier release; this copy was missed.
- **Fix:** `.map(j=>({j,d:_pDate(j.dueDate)}))` in both places.

### M5 — Report CSV export puts every row two days early
- **Where:** `getFilteredTasks` builds `weekKey` with `toISOString` (12058); `exportReportTab` (12525)
- **What the user sees:** A Monday 9 Nov entry exports with Date `2026-11-07` (a Saturday). Every row is shifted back two days. (Checked with node.)
- **Root cause:** `weekKey` is local-Monday-midnight run through `toISOString()`, which gives Sunday's date in NZ. The export then parses it as local midnight, adds `day-1`, and calls `toISOString()` again, shifting back another day. `getWeekKey()` (3974) has the same UTC shift. It's harmless as an internal key, but wrong wherever it's shown: the Business "Hours logged per week" labels and the Settings happiness trend labels show Sunday's date.
- **Fix:** Carry the real date: `tasks.push({..., date:(lt.date||'').slice(0,10)})` and export `t.date`. Build week keys from local parts (the `_localISO` helper in H1) instead of `toISOString()`.

### M6 — People report: utilisation is wildly overstated for "This year", "All time" and "Custom"
- **Where:** `_renderPeopleReport`, `_periodWeeks` (12314)
- **What the user sees:** Pick **This year** and utilisation shows around 1,000%, because a full year of billable hours is divided by about one month of capacity.
- **Root cause:** `{week:1,'2weeks':2,month:4.3,quarter:13}[_period]||4.3` has no entries for `year`, `all` or `custom`.
- **Fix:**
  ```js
  const _cut=_getPeriodCutoff(), _ceil=_getPeriodCeiling();
  const _periodWeeks = _cut ? Math.max(1,(_ceil-_cut)/(7*86400000)) : /* all: span of data */ Math.max(1,(Date.now()-Math.min(...stLoggedTimes.map(l=>_pDate(l.date)))) /(7*86400000));
  ```

### M7 — Streamtime expenses with quantity ≠ 1 show the wrong sell rate, total and margin
- **Where:** `openExpenseDetail` (4568) and the job plan `renderExpenses` (9061, row maths at 9099)
- **What the user sees:** Job 7055 expense #1485988 (qty 2, sell rate $1,500, total $3,000) shows "Sell rate $3,000" and "Total sell $6,000". Job 7065 #1489844 (qty 2, cost 1,950, total 3,900) shows a total of $7,800 and a 50% margin, when the real margin is 0. The row totals no longer add up to the header total. There are 34 expenses with quantity ≠ 1.
- **Root cause:** When `markup` is null or 0, unit sell falls back to `e.sell`, which is mapped from **`totalExTax`** (already the line total), and is then multiplied by `qty` again. `expenses.json` has `sellRate` (the unit price), which is never read.
- **Fix:** Map `sellUnit:+(e.sellRate||0)`, `cost:+(e.costRate||0)` and `total:+(e.totalExTax||0)`. Use `sellUnit` for the "Sell unit" column and `total` for "Total", and compute margin from `costRate` against `sellRate`.

### M8 — Progress tab "Reallocate time" doesn't change anything, and often can't find the entry
- **Where:** `openReallocate` (7747), `applyReallocate` (7792), `_jobTimeEntries` (7613)
- **What the user sees:** Click ⋮ → Move time → pick another job and click "Move time". You get a "Time reallocated" toast and two Activity entries, but the row is still listed on this job. For a logged entry whose item also had a scheduled block that day, or anything logged on a weekend, you get "Could not find this time entry to reallocate".
- **Root cause:** The Progress rows are rebuilt from `stLoggedTimes` / `stScheduledTodos` and never read `todoData`, but `applyReallocate` only changes the `todoData` copy (which H2 wipes anyway). `seedWeekFromST` drops ("consumes") logged cards that pair with a scheduled card, and only seeds Mon–Fri.
- **Fix:** Until Streamtime write-back exists, hide ⋮ on Streamtime rows ("Reallocate in Streamtime"). Or persist a reallocation overlay that `_jobTimeEntries` applies.

### M9 — The "Uninvoiced" lists are flooded with old archived jobs
- **Where:** Invoices → "Show uninvoiced" (`tbiJobs`, 11830); the jobs filter "Uninvoiced" (6932); Reporting → Business "Uninvoiced work" (12251)
- **What the user sees:**
  - "Uninvoiced jobs" lists **469** jobs (465 archived, 305 with $0 logged: templates, "WIP time", 2023 retainers).
  - The Business report says **$460,724** of uninvoiced work, but only **$100,675** of that is on live jobs. 342 archived retainers whose logged time exceeded the fixed fee are counted as "uninvoiced".
- **Root cause:** `_mapStJob` maps every Archived job without an invoice to `workflowStatus:'completed'`. The filters test `workflowStatus==='completed'` and don't exclude `status==='archived'`. The Business report also ignores status, the billable flag and the client filter.
- **Fix:** Add `j.status!=='archived' && j.billable!==false && (j._sellUsed||0)>0`, and in the report also respect `bizCo`.

### M10 — Native invoice numbers start again at #1001 on every page load
- **Where:** `let invCounter=1001` (2803); used in `openInvoice` (9514), `doInvCtx` (11704), `openInvoiceForJob` (11893)
- **What the user sees:** Raise an invoice on one job today and it's #1001. Raise one on another job tomorrow and that's #1001 too. Duplicate invoice numbers end up on printed documents.
- **Root cause:** The counter lives only in memory. (`invNum` also isn't persisted on Streamtime jobs; see H3.)
- **Fix:**
  ```js
  let invCounter=Math.max(1001,+localStorage.getItem('cc_inv_counter')||0,...jobs.map(j=>+j.invNum||0).map(n=>n+1));
  function _nextInvNum(){const n=invCounter++;localStorage.setItem('cc_inv_counter',invCounter);return n;}
  ```

### M11 — The published config overwrites people's own profile edits every 5 minutes, and deleted team members come back
- **Where:** `initStreamtime`, the `platform_config` block (3927); the users merge at `if(!people[key])` (3823); `deletePerson` (10606)
- **What the user sees:** In Settings → My Profile, a change to display name, role, team, colour or "Dashboard teams" reverts on the next poll (for anyone who isn't the publisher with a GitHub token). A team member removed in Settings → Team reappears within 5 minutes.
- **Root cause:** On every poll, `people[k]={...people[k],...cfg.people[k]}` writes the published values over local ones. Every Streamtime user missing from `people` is recreated, and deletion leaves no tombstone.
- **Fix:** Apply `platform_config` once per published version (store `cfg.published_at` and skip if already applied). Turn `deletePerson` for `st_*` keys into "archive" (`_archived:true`) instead of `delete`.

### M12 — Data stops saving without warning once browser storage is full
- **Where:** `persistNativeData` (3499, `catch(err){}`); `_activityFileDrop` (9393, up to 500K chars per image); `setBgImage` (2684, up to 2.5M chars)
- **What the user sees:** After setting a wallpaper and attaching a few images to job activity, nothing native gets saved any more: native jobs, milestones, expenses, phases, split invoices, activity and time. There's no error, and toasts still say "saved". On the next reload everything since the last successful save is gone.
- **Root cause:** Browsers cap localStorage at about 5M characters. All of the native overlay goes into one `cc_job_overlay` value, so a single `QuotaExceededError` fails the whole save, and the error is swallowed.
- **Fix:** Catch the error and `toast('Browser storage is full — recent changes are NOT saved','warn')`. Store activity images in IndexedDB (or drop them from the overlay), and cap the wallpaper lower.

### M13 — Global search can't find invoices by job number or job name
- **Where:** `runGlobalSearch`, invoices block (10737)
- **What the user sees:** Searching "6593" or "Deer Packaging" finds the job and its quote, but **not** INV-5261 for that job. The invoice result never shows the "· #job" suffix either.
- **Root cause:** The code reads `inv.jobNumber` and `inv.jobName`, but `invoices.json` has neither field. It has `jobId` (the ST internal id) plus `name` / `reference`, e.g. "[6593] Deer Packaging".
- **Fix:**
  ```js
  const j=jobs.find(x=>x._stId===inv.jobId);
  const hay=`${inv.number||inv.id} ${co} ${j?.id||''} ${j?.name||''} ${inv.reference||inv.name||''} ${st}`;
  ```

### M14 — Phases from Streamtime always show as Open (red), even when every item is complete
- **Where:** `_mapStJob`, `const phStatusName=` (3741); used by `renderPhases` and the Timeline tab
- **What the user sees:** On the Job Plan, every phase has the red "open" dot, and the Timeline draws every phase bar red ("Open"), even when all items are Complete. 13 phases on live jobs are fully complete right now.
- **Root cause:** It reads `ph.jobPhaseStatus?.name || ph.status`, but phases in `jobs.json` only have `id, jobId, name, orderId, items`.
- **Fix:**
  ```js
  const allDone=(ph.items||[]).length>0&&ph.items.every(it=>it.jobItemStatus?.name==='Complete');
  status: allDone?'complete':'open',
  ```

---

## Low

### L1 — The To Do week label goes stale
- **Where:** `updateWeekLabel` (6359) is called only from the To Do arrows and buttons.
- **What the user sees:** The header shows a different week from the board.
- **Trigger:** Change the week on the **Schedule** view, from the todo modal's **mini calendar**, from a **search result**, or by entering **Focus mode** from another week, then look at To Do.
- **Fix:** Call `updateWeekLabel()` at the top of `renderTodo()`.

### L2 — "Budget used % (top 10)" isn't the top 10
- **Where:** `_renderJobsReport`, `const budgetJobs=` (12403)
- **Root cause:** It sorts by `b.bPct`, but Streamtime jobs only have `_bPct`. The comparator always returns 0, so the chart shows the 10 jobs with the most hours.
- **Fix:** Sort on `(b._bPct||0)-(a._bPct||0)`.

### L3 — The "Job Number" filter in Quotes and Invoices matches substrings (bug class 3)
- **Where:** `_applyQtFilters` (11415), `_applyInvFilters` (11438)
- **What the user sees:** Filtering for job "700" also returns 7000–7009 and 1700.
- **Fix:** `String(qt.jobNumber||'')===f.value.trim()` (or a "starts with" option offered explicitly).

### L4 — "Today" is taken as the UTC date in several places (bug class 2 variant)
- **Where:**
  - the To Do data-freshness "stale" test (5310);
  - the Deadlines calendar's today outline (10055);
  - default dates for New quote (9168), Add expense (`le-date`, 4689) and the job-plan expense form;
  - `dbCreateExpense` (2739);
  - native invoice issue and due dates (9514, 11893–11902);
  - the quote revision date and the split invoice date.
- **What the user sees:** Before 1pm NZ these all use yesterday's date. For example, the calendar outlines yesterday, and new quotes and expenses default to yesterday.
- **Fix:** Use `_localISO()` from H1.

### L5 — Streamtime text goes into innerHTML without `esc()` (bug class 1), and one modal truncates names
- **Where (all new instances):**
  - Progress tab rows `r.item` / `r.title` (7710): logged and scheduled notes;
  - Time tab `e.title` (11153);
  - board card task titles (12656, 12818);
  - Activity details built from task titles in `moveScheduleTask` (4410) and `applyReallocate` (7808), which are then **persisted** in the activity log;
  - Quotes list `quoteName` / `company` / `jobName` (11658–11659);
  - quote and invoice document previews (company, `job.name`);
  - Jobs list company (6997) and group headers;
  - the job header `d-meta-line` company;
  - Dashboard client cards (`co`);
  - Deadlines calendar invoice label (10048);
  - the Starred panel.
- **Real-data impact today:** Job 4817's name contains double quotes (`99% Sugar Free Cappuccino "Strong" pack concept`). The **Job Settings** modal writes it into `value="${j.name}"` (7273), so the field shows only `99% Sugar Free Cappuccino `, and clicking Save **writes back the truncated name**. 796 item descriptions contain HTML, but they aren't rendered anywhere.
- **Fix:** Wrap the values in `esc()`. In the modals, set `input.value` after the modal is created instead of interpolating.

### L6 — Time tab "Last month" leaves out the last day of the month
- **Where:** `_filterByRange` (11055)
- **What the user sees:** "Last month" leaves out the month's last day. "Last week" also leaves out Sunday.
- **Root cause:** The end bound is `new Date(y,m,0)` (00:00 on the last day), but entry dates are created at 12:00.
- **Fix:** Use `d < new Date(now.getFullYear(), now.getMonth(), 1)` as the end test.

### L7 — Jobs list ordering and the "Showing X of X" text
- **Where:** `renderJobs`, `const sorted=` (6901) and `sentinel.innerHTML` (7022)
- **What the user sees:**
  - Jobs created in the platform sort to the **bottom** of the 180-row live list. The list sorts by `Number(_stId||id)`, so a native "7301" sorts below Streamtime ids around 2,000,000.
  - The lazy-load row reads "Showing 180 of 180 jobs — scroll for more", because both numbers are `shown` / `filteredJobs.length`.
- **Fix:** Sort native jobs by `_createdAt` first. Show `_jobsRenderedCount` in the lazy-load row.

### L8 — Day capacity label hard-coded to 8h
- **Where:** `renderTodo` (5362) and `renderTodoHeader` (5772)
- **What the user sees:** The OVER label always says "/ 8h", even though `DAY_CAP` is per person (e.g. 6.4h for a 4-day week). After a card resize, `renderTodoHeader` recomputes the bar against 8h.
- **Fix:** Pass `DAY_CAP` through to both places.

### L9 — Hibernated Streamtime users show up as active
- **What the user sees:** Ali Puchala, Harry Ross (old account 115477, next to the active 184734), Maggie Going and Yash Trimbakkar are `userStatus: Hibernated` but not `_archived` in `platform_config.json`. They appear in Dashboard team cards, Schedule, reassign menus and the person switcher.
- **Root cause:** The code computes `stUsersById[id].active` but never uses it to filter `people`.
- **Fix:** Treat `!stUsersById[p._stId]?.active` as archived in the people filters.

### L10 — Settings → Data always says "Last synced: Unknown"
- **Where:** 10344
- **Root cause:** `cc_last_sync` is never written.
- **Fix:** Fetch `sync_meta.json` (`last_synced`) along with the other files and show that.

### L11 — The follow-up card appears after *adding* a task, with old text
- **Where:** `saveTodo` (new-task branch) → `fup.classList.add('on')` with `_fupTask=null`
- **What the user sees:** After adding a task, the card asks about whichever task was last completed, e.g. "Done! Need to add more time to 6928 …?".
- **Fix:** Drop that `setTimeout`, or reset `#fup-bd` and hide `#fup-hrs-wrap` first.

### L12 — Phase hour totals ignore items planned under an hour
- **Where:** `pHrs` (8606) and the quote tab `phHrsMin` (8274)
- **What the user sees:** Items planned for less than an hour (44 items on live jobs) are dropped from phase totals.
- **Root cause:** The regex `/(\d+)h(?:(\d+)m)?/` needs an "h", but `_stFmtH(45)` gives `"45m"`.
- **Fix:** Use `Math.round(parseHrsInput(i.hours)*60)`.

### L13 — Reporting drops weekend logged time
- **Where:** `getFilteredTasks`, `if(dayNum<1||dayNum>5)return;` (12046)
- **What the user sees:** 7 weekend entries (7.4h, $1,112) are missing from every report. Separately, "This week" and "This month" are actually rolling 7- and 30-day windows.
- **Fix:** Keep the entries and only skip them in the Mon–Fri day chart. Rename the period labels ("Last 7 days" and so on) or switch to calendar periods.

### L14 — Minor data and listener issues
- **Duplicate job numbers:** Streamtime has duplicate job numbers 4474, 4483 and 4438 (archived Sept 2023 retainers). Because `id = number`, the second job of each pair can't be opened.
- **Client addresses:** `_mapStCompany` (3768) reads `addr.country`, but the field is `countryName`, so country is dropped.
- **Primary contact:** The client's primary contact is the first contact found, which is an archived person for 3 companies and "Accounts" for 11. That name is what appears under "Prepared for" on quote and invoice previews.
- **Context-menu listener:** `renderTodo` adds a new capture `contextmenu` listener to `#day-cols` on **every** render (5277). `oncontextmenu=null` doesn't remove `addEventListener` listeners, so a right-click on empty space calls `openTodoModal` N times. The new window-resize re-render makes N grow faster.
- **⌘K todo at weekends:** `_cmdQuickTodo` (10685) puts a weekend "todo …" on the past Monday.

---

## Unverified / needs a decision

1. **Exact storage threshold for M12:** Depends on browser (Safari is stricter). The failure mode was confirmed from the code, not reproduced in a browser.
2. **Dedupe of native time against later Streamtime entries:** The signature `userId|job.number|date|minutes` also misses when the person logs a slightly different duration in Streamtime. How much double-counting this causes in practice depends on how testers use the follow-up prompt after H1 is fixed.
3. **Follow-up card and the poll:** `#fup` is not in the poll's "modal open" skip list, so a poll can fire while the card is showing. No concrete user-visible failure was confirmed beyond H2.
4. **Item status "In Play" mapped to "open":** Streamtime item statuses are `In Play / Complete / Paused`, and the code's `'In Progress'` branch never matches. Whether an "in progress" badge was intended is a product decision.
