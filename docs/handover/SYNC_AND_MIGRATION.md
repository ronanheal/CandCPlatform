# Streamtime sync, data gaps and migration plan

*How data gets from Streamtime (ST) into the platform today, how that breaks, what ST holds that the platform doesn't capture, and a proposed path to switching ST off. Script references are `file:line` at commit `b6f7efb`. That commit is **not yet deployed** (§1.6).*

---

## 1. How the sync works today

### 1.1 Components

| Piece | File | Role |
|---|---|---|
| Workflow | `.github/workflows/streamtime-sync.yml` | One job (timeout 355 min) runs `sync_loop.sh`, then on success queues its own successor (`gh workflow run`, lines 35–39). A cron `17 */2 * * *` is only a backup restart (line 5). `concurrency: streamtime-data-branch` keeps it to one run at a time |
| Loop | `scripts/sync_loop.sh` | For ~5.5 h (`RUN_FOR`, line 16), runs a cycle every 15 min: a **full sync** when an hour has passed since the last good one, otherwise a **fast sync** (lines 67–93) |
| Full sync | `scripts/streamtime_sync.py` | Everything: reference endpoints, jobs (+ phases/items for active jobs), logged time, quotes, invoices, companies, contacts, expenses, assignments, milestones, scheduled todos, `sync_meta.json` |
| Fast sync | `scripts/streamtime_fast_sync.py` | Only logged time, scheduled todos and job assignments (the To Do board's inputs) |
| Logged-time sweep | `scripts/logged_times_sweep.py` | Order-independent paging of view 8 with a resumable cursor, a recent-window fast path, and record slimming (see 1.4) |
| Publish | `sync_loop.sh` `restore()` 27–35, `publish()` 37–62 | Pulls the current data-branch files, runs the script, then commits **one parentless commit** of all `*.json` and force-pushes with `--force-with-lease`. Files written by others (`platform_config.json`, `changelog.json`, `platform_meta.json`, `roadmap.json`, `vercel.json`) are never touched (`NOT_OURS`, line 22) |
| Meta | `.github/workflows/generate-meta.yml` + `scripts/generate_meta.py` | On push to `main`, writes changelog/meta/roadmap JSON to the data branch (for a Google Sheet). Not part of the ST data path |
| Browser | `index.html` `initStreamtime` 3704, poll 11807 | Fetches the files from `https://raw.githubusercontent.com/ronanheal/CandCPlatform/streamtime-data/…` on load and every 5 minutes, cache-busted |

Credentials: `STREAMTIME_API_KEY` is a GitHub Actions secret. There's no local copy, so live API probing means pushing a change and reading the Actions logs.

### 1.2 Streamtime endpoints used

Base `https://api.streamtime.net/v1` (`streamtime_sync.py:38`), Bearer auth. Phase and item detail come from `https://contentco.app.streamtime.net/api/v1` (line 39), which is the tenant app API. **Whether that host is officially supported for API clients is unknown.**

| Call | What | Query / notes | Output file |
|---|---|---|---|
| `GET /organisation`, `/users`, `/roles`, `/branches`, `/rate_cards` | reference | | same-name `.json` |
| `POST /search?search_view=7` | jobs | `job_status in ["In Play","Complete","Paused","Archived"]`, `additionalData:["company"]` (226–227) | `jobs.json` |
| `GET {app}/jobs/{id}/job_phases`, `/job_items` | plan detail | 2 calls per job (143–158) | merged into `jobs.json` |
| view 8 | logged time | no query (sweep). Status 2 = Logged | `logged_times.json` |
| view 8 | scheduled blocks | `logged_time_status = 1` (358) | `scheduled_todos.json` (slimmed) |
| view 9 | logged expenses | | `expenses.json` |
| view 10 | quotes | "do not swap 10/11" (338) | `quotes.json` |
| view 11 | invoices | | `invoices.json` |
| view 12 / 13 | companies / contacts | | `companies.json` / `contacts.json` |
| view 17 | job item users (assignments) | `job_status in ["In Play","Paused"]` (347) | `job_assignments.json` |
| view 18 | milestones | | `milestones.json` |

Search requests post `{query, limit:500, offset}` and read `searchResults`, which may be a dict or a list (`streamtime_sync.py:80–140`). **The view ids are ST saved views.** What each view returns, including its default filters and sort order, is configured on the ST side. That's exactly what broke in October (§2, row 1).

### 1.3 Rate limit and cadence

ST allows **720 requests/hour**. Per the script docstrings at HEAD: full sync ≈ 330 calls (about 300 of them for the active-job phase/item refresh), fast sync ≈ 35 calls (`streamtime_fast_sync.py:19–21`), so roughly 435/hour. Phase/item detail backfill ran 300 jobs per run until `sync_progress.json.backfill_complete` was true (`streamtime_sync.py:252–315`). After that, only In Play and Paused jobs are refreshed (line 275). **Archived and complete jobs' plans are frozen at whatever was fetched once.**

### 1.4 Logged time (`logged_times_sweep.py`, HEAD only)

- `sweep()` (117) walks the whole of view 8, up to N pages per cycle (40 for a full sync, 25 for a fast sync), resuming from `offset` in `logged_times_sweep.json`. Pages overlap by 50 records to absorb mid-list inserts. A page that fails three cycles in a row is skipped. Records are union-merged by id, newest copy wins (98–107).
- `probe_recent_queries()` (160) runs hourly and tests candidate filters (`date >= "…"`, newest-first under a status filter) with one 50-record request each. It keeps the first one that demonstrably returns recent records.
- `recent()` (203) uses that query to keep the last 21 days fully current every cycle.
- `slim()` (43) cuts each record to the fields `index.html` reads (from ~5 KB to ~0.5 KB).
- Freshness is reported as `last_complete_pass_at` in `logged_times_sweep.json`. The To Do "data through…" indicator reads this, not the newest entry date.

### 1.5 Guards in `save()`

`streamtime_sync.py:161–191`: a list is never overwritten by an empty result or by **fewer than 50% of the previous count** (it falls back to a `.bak` if the previous file was empty). The fast sync only guards against empty (`streamtime_fast_sync.py:119–127`). `jobs.json` is saved **without** a `previous` (line 384), so only the "0 jobs, skip run" check at 232–238 protects it.

### 1.6 Production vs HEAD (important)

Local `main` is ahead of `origin/main` (by 4 commits as of 9 Nov 2026, the first being `b6f7efb`). Commit `b6f7efb` (v2.38.1) adds the sweep, the slimming, and the 429-as-error handling in both scripts, and **it hasn't been pushed**. The workflow checks out `main` from GitHub (`streamtime-sync.yml:23–26`), so production still runs `183bfdc`:
- `logged_times = search(8, timeout=180)` (unbounded, order-dependent) plus a `date < oldest` deep-history query, tracked as `logged_times_oldest_fetched` in `sync_progress.json` (currently `2025-12-22`).
- In `search()`, a page that exhausts its retries on 429 still `break`s and returns the partial list as if complete. That's silent truncation.
- `logged_times.json` holds full raw records (53 MB) and there's no `logged_times_sweep.json` on the branch.

The live data confirms it. Weekly logged hours from `logged_times.json` (8 Nov 2026 export): w/c 14 Sep 524 h, 21 Sep 516, **28 Sep 281, 5 Oct 57, 12 Oct 49, 19 Oct 50, 26 Oct 31, 2 Nov 56**. The normal level is ~500 h/week across ~14 people.

---

## 2. Known failure modes

| # | Failure | Status | Evidence / reference |
|---|---|---|---|
| 1 | **ST changed view 8's default order** (~28 Sep–1 Oct 2026) from newest-first to job-grouped. A fetch that the rate limit cut short kept re-reading old jobs, so ~10% of October arrived and nothing new by November | Fixed in `b6f7efb`, **not deployed** | `logged_times_sweep.py:5–11`; ROADMAP v2.38.1; §1.6 numbers |
| 2 | **Silent truncation on 429**: retries ran out and the loop fell through as "end of results", with `errors: []` in `sync_meta.json` | Fixed in `b6f7efb` (`streamtime_sync.py:125–131`, `streamtime_fast_sync.py:92–97`), **not deployed** | |
| 3 | **Empty `users.json` committed** after a transient empty response, which blanked the To Do board, Schedule and Reporting (14 Jul 2026) | Fixed v2.36 (`streamtime_sync.py:213–222`). The app also falls back to cached people (`index.html:3762`) | ROADMAP v2.35/v2.36 |
| 4 | **GitHub cron unreliable** (from late Aug 2026 it fired only 3–6 times a day) | Worked around with the self-chaining loop. If a run *fails*, the chain stops and recovery waits for the 2-hourly cron, which is itself unreliable | `sync_loop.sh:3–7`, `streamtime-sync.yml:4–7, 33–37` |
| 5 | **Deletions in ST are never removed**: logged time is union-merged by id | Open | `logged_times_sweep.py:98`; ROADMAP v2.38.1 "Not yet done" |
| 6 | **50% guard can freeze a file**: if a view genuinely shrinks by more than half (e.g. an ST view filter change), the file stops updating with no error | Open, by design | `streamtime_sync.py:184–186` |
| 7 | **1,345 archived jobs have no phases/items**, while `sync_progress.json` lists 2,742 ids as `detail_done`. Phases are only carried forward from the previous `jobs.json` (242–250) and `detail_done` is trusted, so if detail is ever lost it's never re-fetched. The original cause is **unknown** | Open | jobs.json: 1,387 of 2,732 jobs have a `phases` key |
| 8 | **Export views return partial history**: invoices 83 (Feb–Oct 2026, one branch) against 2,162 jobs with issued invoices; quotes from Apr 2026; expenses from Dec 2025; logged time from Jul 2025. Whether that's ST view filters, pagination or API limits is **unknown** | Open | DATA_MODEL.md §6 |
| 9 | **Assignments only for active jobs**; scheduled todos only status 1 | By design (rate budget) | `streamtime_sync.py:345–348` |
| 10 | **The browser downloads ~77 MB on load and every 5 minutes**, with no caching (`?v=Date.now()`) | Open (slimming shrinks logged time ~10× once deployed) | `index.html:3713, 11807` |
| 11 | **Data is public**: the repo is public, so every file on the data branch (staff emails and rates, client contacts, invoices) downloads without auth | Open. **Fix before handover if possible** | `gh repo view` → `PUBLIC`; `ST_BASE` `index.html:3487` |
| 12 | **Mixed versions possible**: the browser fetches 11 files concurrently from a CDN that caches for minutes, so it can mix files from different publishes | Unknown impact | — |
| 13 | **Duplicate / missing job numbers in ST** (`4474`, `4483`, `4438` twice; 48 null; one `"N/A"`) collide on the internal job id | Open (data) | DATA_MODEL.md §6 |

**How to diagnose a data gap today** (from the maintainer's notes): extract a file with `git show origin/streamtime-data:<file>.json`, bucket `logged_times.json` minutes by ISO week (normal ≈ 500 h/week), and read the Actions logs (`gh run view <id> --log`) for `view=8 offset` and `rate limited` lines. Freshness comes from `logged_times_sweep.json` (after deploy), not the newest entry date.

---

## 3. What ST holds that the platform doesn't capture

| Data in ST | Captured today? | Notes |
|---|---|---|
| Logged time before 2025-07-08 | **No** | Export starts there. Jobs go back to Aug 2023 (`jobCreatedDate`) |
| Logged time: approval status, start/end times | **No** | Not in the view-8 payload (ROADMAP "Data gaps") |
| Logged time: cost | Effectively no | `totalCostExTax` is 0 on all 15,555 records. User `costRate` is 0 for 36/37 |
| Phases/items for 1,345 archived jobs | **No** | §2 row 7 |
| Item **sub-items** (checklists) | **No** | 6,673 counted on items (`incompleteJobItemSubItems`/`completeJobItemSubItems`), with no content exported |
| Item costing method, time allocation method, billable flag, order | Exported, **not mapped** | DATA_MODEL.md §3.3 |
| Phase order and status | Order exported, not mapped. Status **not exported** | |
| Assignments (job item users) on non-active jobs | **No** | ~28k total per script comment, ~2.2k exported |
| Invoices outside the 83 exported; invoice **line items**; credit notes | **No** | `invoiceType` is always "Invoice" in the export |
| Quotes before Apr 2026; quote **line items** | **No** | |
| Expenses before Dec 2025; suppliers; purchase orders | Partially | Supplier fields are all null; 1 PO |
| Job contact, job lead, rate card, branch, currency, created/completed/archived dates | Exported, **not mapped** | DATA_MODEL.md §3.1 |
| Rate cards **with rates** (per role/item) | **No** | Only names are exported |
| Company status, labels, tax number, branch; contact labels/status | Exported, mostly not mapped | |
| User role ids, job titles, labels, weekend hours, leave | Partially | `leaveBalance` isn't in the export (ROADMAP) |
| ST job activity, comments, notes, files | **No** | No export exists |
| Xero links on invoices | Exported (`externalInvoiceId`) | Needed to keep the accounting link |
| ST-side deletes | **No** | §2 row 5 |

**Conclusion:** the migration must read from the **ST API directly, for full history**, not from the `streamtime-data` JSON files. The files are getting thinner on purpose: `slim()` already drops logged-time fields, and the local commit `b9131cd` (`scripts/jobs_slim.py`) will drop every job and item field `_mapStJob` doesn't read. Before Jan 2027, ask ST (support or account manager) for a bulk export and whether the 720/h limit can be raised temporarily for the backfill. The total logged-time record count in ST is **unknown**. At 500 records per page, the existing sweep can read ~50k records/hour within the budget.

## 4. What the platform holds that ST doesn't

All of it is in **browser localStorage, per user and per device**:
native jobs; job overlays (field edits, pause, activity, split invoices, native milestones/expenses/phases/items); native time entries; native quotes and quote versions; client edits (nickname, group, lead, local contacts); people edits (team, hours, rate, dashboard prefs); boards; labels; catalogues; workspace settings; mood log; starred; deletion tombstones. The only shared copy is `platform_config.json` (people, labels, catalogues), last published 16 Jun 2026.

Not stored anywhere: To Do board tasks created or edited in the platform, reallocations, itemised expense sub-lines, invoice counter (DATA_MODEL.md §4).

---

## 5. Proposed migration path

**Mirror → Validate → Switch off.** The front end stays. The backend ingests ST and native data in parallel until the numbers agree, then becomes the system of record.

### Phase 0: before Razor starts (Dec 2026). Owner: C&C

1. **Deploy the logged-time fix** (push `b6f7efb`) so the October–November gap backfills, and confirm `logged_times_sweep.json` shows a completed pass. *(This is the maintainer's decision: it hasn't been pushed.)*
2. **Stop publishing client data publicly**: make the repo private (the browser's raw URL fetch then needs a token or proxy), or move the data behind auth.
3. Give Razor ST API access (a separate API key if ST allows one) and a read-only copy of the Actions logs.
4. List **every person and device that has used the platform**. Their browsers hold native data (§5 Phase A, step 3).
5. Tell staff: until cutover, **ST is the record for time, scheduling, quotes and invoices.** Board edits in the platform don't persist.

### Phase A: mirror (Jan–Feb 2027)

1. **Schema.** Model the entities in DATA_MODEL.md §3 with an `st_id` external key on everything that came from ST, the job **number** as a unique business key (resolve the duplicates first, see checklist), numeric money and minutes, and dates as `date`, not timestamp.
2. **ST ingestion worker** (server-side, replacing the GitHub Actions loop):
   - A one-off **full-history backfill** per entity straight from the ST API: all jobs plus phases/items for *every* job (not just active), all logged time, all invoices/quotes/expenses, assignments for all jobs, companies and contacts including archived/deleted, and users including hibernated/deleted (historic time references them).
   - **Store the raw ST payloads** (e.g. a JSONB column) beside the normalised rows. It's cheap insurance against mapping mistakes, which have been the main bug class (ROADMAP audit).
   - Then **incremental sync** using the logic from `logged_times_sweep.py` (order-independent, resumable, 429 = error, never a silent stop), plus **delete detection** (full id-set comparison per pass).
   - Record per-entity freshness and errors where the UI can show them.
3. **Harvest native data from browsers.** For each person and device on the list: open the live site, use Settings → Data → **Export workspace** (covers `WORKSPACE_KEYS`, `index.html:2745`), **and** collect the seven keys the export leaves out (`cc_deleted_jobs`, `cc_quote_versions`, `cc_quote_opts`, `cc_ws_settings`, `cc_happiness`, `cc_starred`, `cc_hidden_uninvoiced`). A small "Export everything for migration" button, or a console snippet that dumps every `cc_*` key **except `cc_gh_token`** (a secret) and `cc_bg_image` (a wallpaper), will do it. Repeat at cutover for the delta.
4. **Merge native into the backend** with the same precedence the app uses (`applyNativeData`, `index.html:3458`): `_native` field patches override ST fields; native milestones, expenses, phases, items, split invoices and activity are added to the ST job; tombstoned ids are hidden. Across browsers: union activity by `ts`; flag conflicting `_native` patches for review; **check native job numbers for collisions**, since each browser allocated `nextJobNumber()` independently (`index.html:3876`).
5. **Serve reads to the front end** (API_CONTRACT.md §1, Option A) on a staging URL behind auth. The UI doesn't change except for `ST_BASE`.
6. **Implement the write endpoints** (API_CONTRACT.md §2) for platform-owned entities first (jobs overlay, activity, boards, labels, settings, clients, people, quotes, split invoices, expenses, milestones), then the To Do board, then time entries.

**System of record during the mirror:**

| Entity | Source of truth until cutover |
|---|---|
| Logged time, scheduled blocks, assignments, ST invoices, ST quotes, ST expenses, job core fields, phases/items, companies, contacts, users | **ST** (ingested read-only) |
| Native jobs, overlays, activity, split invoices, native quotes and versions, boards, labels, catalogues, settings, preferences, client extras, people extras | **Backend** (seeded from the harvest) |

Don't take time entries or scheduling in the platform during the mirror unless a write-back to ST exists. There are no ST write credentials today (ROADMAP "Deferred: ST write-back"), so dual entry would diverge.

### Phase B: validate (Feb–Mar 2027)

- Run the checklist in §6 automatically every night and publish the diff report.
- Run the staging front end against the backend in parallel with production. Dashboard, Reporting and job Progress numbers must match for the same period.
- Get **finance sign-off** on invoices/WIP for the last complete month, and **studio sign-off** on a sample of active jobs (plan, time, budget).

### Phase C: switch off (target late Mar 2027)

1. Announce a freeze window and stop all writes to ST.
2. Final ST delta ingest, then a final browser harvest, then re-run §6 (must be clean).
3. Point production at the backend. Turn on the time, To Do and invoice write paths.
4. **Xero:** ST pushes invoices to Xero today (`externalAccountingPlatformName: "Xero"`, `externalInvoiceId` on every invoice). If the platform can't create Xero invoices by cutover, invoicing has no home. **Treat the Xero integration as a cutover blocker**, or keep ST for invoicing only for a defined period.
5. Keep ST **read-only for an agreed period** (e.g. 3 months) for reference and rollback. Keep the ingestion worker able to run once more.
6. Rollback: because the backend can serve Option A files, the current front end can be pointed back at an ST-fed copy if needed.

### Phase D: decommission

Take a final full raw ST export to cold storage. Delete `.github/workflows/streamtime-sync.yml`, `scripts/streamtime_*.py`, `scripts/logged_times_sweep.py`, `scripts/sync_loop.sh` and the `streamtime-data` branch (then ask GitHub to purge cached objects if the repo stayed public). Remove `initStreamtime`, `_mapStJob`, `_mapStCompany`, the overlay code and the 5-minute poll (API_CONTRACT.md §4). Revoke the ST API key and the GitHub PAT stored in the admin's browser (`cc_gh_token`).

---

## 6. Pre-cutover data-quality checklist

Run each check against ST (API) and the backend. Unless a tolerance is given, a check passes only when the difference is zero.

**Identity and keys**
- [ ] Every ST job id is present once. Job numbers are unique: resolve `4474`, `4483`, `4438` (duplicated), the 48 null numbers and `"N/A"`.
- [ ] Native job numbers (from every harvested browser) don't collide with each other or with ST.
- [ ] Every `job.company` resolves to a company **id** (not just a name). Company names are unique, or the duplicates have been consciously kept.
- [ ] Every user referenced by time, assignments or members exists (including hibernated/deleted). Each active user has a login email.

**Completeness against ST aggregates.** ST computes per-job totals, so use them as the oracle:
- [ ] Per job: Σ logged `minutes` = `totalLoggedMinutes`; Σ logged `totalExTax` = `totalLoggedTimeExTax`.
- [ ] Per job: Σ item `totalPlannedMinutes` = job `totalPlannedMinutes`; every job (including archived) has its phases/items.
- [ ] Per job: Σ non-draft, non-voided invoice `totalAmountExTax` = `totalIssuedInvoicesExTax`; Σ paid = `totalPaidInvoicesExTax`; awaiting = `totalAwaitingPaymentInvoicesExTax`.
- [ ] Per job: Σ approved quotes = `totalApprovedQuoteExTax`; Σ expenses = `totalLoggedExpensesExTax` (sell) and `totalLoggedExpensesCostExTax` (cost).
- [ ] Logged time runs back to ST's earliest entry. Weekly hours per person have no unexplained dips (flag any week below 60% of that person's trailing 8-week median and check it against leave).
- [ ] No record in the backend whose `st_id` no longer exists in ST (deletions handled).
- [ ] Scheduled blocks: the count of status-1 entries matches, and none point at missing jobs or items.
- [ ] Every ST invoice keeps its Xero `externalInvoiceId`.
- [ ] Assignments exist for all jobs, not only active ones (if the product keeps using them).

**Native data**
- [ ] A harvest was collected from every person and device on the Phase 0 list (record key counts per browser).
- [ ] Every overlay entry maps to an existing job. Orphans are listed and resolved.
- [ ] A report of every ST job where a native `_native` patch differs from ST (name, dates, status), signed off on which value wins.
- [ ] Native time entries deduped against ST with a stronger rule than today's `user|job|date|minutes` signature (`index.html:3813`), and the remainder manually reviewed.
- [ ] Native time entries created before commit `7ee5329` checked for UTC off-by-one dates (stamped the previous day before 1 pm NZ) and for duplicates logged via the follow-up "No thanks" button.
- [ ] Native quotes vs ST quotes, and split invoices vs ST/Xero invoices, checked for duplicates (double-billing risk).
- [ ] Client records created by the name merge (`st-…` vs `cl-…` for the same company) de-duplicated. Local contacts reconciled with ST contacts.
- [ ] Tombstoned jobs (`cc_deleted_jobs`) confirmed as intentionally deleted (they still exist in ST).
- [ ] Activity `detail` HTML sanitised on import (stored-XSS risk). Inline `img` data URLs moved to file storage.
- [ ] Activity attribution: entries are stamped with `MY_PERSON` (Ronan) whatever the real author (`index.html:2772`). Decide whether to keep them as-is or relabel them "unknown author".

**Semantics**
- [ ] Dates stored as calendar dates. Entries logged near midnight NZ land on the same day as in ST.
- [ ] The 3 USD jobs and any `exchangeRate ≠ 1` records are handled explicitly.
- [ ] Item sell values: the app recomputes minutes × rate, while ST stores `totalPlannedTimeExTax` / `totalLoggedTimeExTax`. Decide which is canonical, and list the jobs where they differ (value-costed items).
- [ ] Workflow stage (`quote/live/completed/invoiced`) and status (`inplay/complete/archived`, paused flag) rules are agreed for jobs that have no ST status any more.

**Sign-off**
- [ ] Dashboard KPIs, Reporting (billable %, utilisation, revenue by client) and job Progress match between the backend and the current platform for the last full month (once logged time is complete).
- [ ] Finance has signed off invoices and WIP. Studio has signed off a sample of active jobs.
- [ ] A rollback was rehearsed once on staging.
