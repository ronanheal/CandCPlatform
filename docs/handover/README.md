# C&C Platform: technical handover

*Written 9 Nov 2026 for Razor, who take over in December 2026. Code references point at commit `b6f7efb` (v2.38.1). See the caveat about line numbers at the end of this page.*

## What it is

The C&C Platform is Content & Co's internal studio tool: jobs, job plans (phases and items), a weekly To Do board, team schedule, time, expenses, quotes, invoices, clients, reporting, boards and a dashboard. About 37 Streamtime (ST) users exist (16 active). The agency runs on **Streamtime** today, and the platform is a front end over a copy of Streamtime's data, plus a thin layer of data created in the platform itself.

**The job you're taking on:** keep this front end and its architecture, and build the backend (Jan–Mar 2027) so Streamtime can be switched off. The client has said "the data is key", so the data model and the migration are the core of the work.

## How it works today

```
Streamtime API ──(GitHub Actions, every 15 min / hourly)──► JSON files on the `streamtime-data` branch
                                                                  │  (public raw.githubusercontent.com URLs)
                                                                  ▼
                        index.html in the browser: initStreamtime() fetches ~11 files on load and every 5 min,
                        maps them (_mapStJob, _mapStCompany …) into in-memory globals (jobs, stLoggedTimes …)
                                                                  │
                        native edits (db* stubs + ~90 direct mutation functions) ──► localStorage (THIS browser only)
```

- **Front end:** one file, `index.html` (13,132 lines: CSS, then HTML, then one big `<script>` from line 2511). Vanilla JS, no framework, no build step, no package.json. CDN dependencies: Chart.js 4.4.7, Lucide 0.525.0, Tabler icons webfont (`@latest`, so the version isn't pinned: `index.html:8`), Google Fonts (Inter, Inter Tight).
- **Data in:** Python scripts in `scripts/` run inside GitHub Actions and write JSON to the `streamtime-data` branch. Details are in [SYNC_AND_MIGRATION.md](SYNC_AND_MIGRATION.md).
- **Data out:** there is no backend. Native writes go to `localStorage` in each user's browser. The only shared write path is the "Publish config" button, which commits `platform_config.json` to GitHub using a personal access token stored in the browser (`publishConfig`, `index.html:10370`).

## Deployment

| Thing | Where |
|---|---|
| App | Vercel, auto-deployed on push to `main`. Production URL: `https://cand-c-platform.vercel.app` (from `platform_meta.json` on the data branch) |
| Vercel config | `vercel.json`: only turns off deploys for the `streamtime-data` branch |
| Data | `streamtime-data` branch of `github.com/ronanheal/CandCPlatform`. The workflow replaces it with one parentless commit per publish |
| Sync runner | `.github/workflows/streamtime-sync.yml` → `scripts/sync_loop.sh`. Secret: `STREAMTIME_API_KEY` (GitHub secret only, there's no local copy) |
| Meta / changelog | `.github/workflows/generate-meta.yml` → `scripts/generate_meta.py`. On each push to `main`, it writes `changelog.json`, `platform_meta.json` and `roadmap.json` to the data branch (these feed a Google Sheet) |

> **Deployment state at handover (verified 9 Nov 2026):** local `main` is **ahead of `origin/main`** (by 4 commits at the time of writing, the first being `b6f7efb`). Commit `b6f7efb` (v2.38.1, the logged-time sync fix plus `scripts/logged_times_sweep.py`) has **not been pushed**. Production (the app and the sync) is still running `183bfdc`, and the live `logged_times.json` still has the October gap: weekly logged hours drop from about 500 h to about 50 h from w/c 28 Sep 2026. See SYNC_AND_MIGRATION.md §2.

## Where things live in `index.html`

Search by function name, because line numbers drift.

| Area | Functions (line at `b6f7efb`) |
|---|---|
| db* stub layer (the intended API seam) | `dbCreateJob` 2632 … `dbDeleteMilestone` 2683 |
| Native persistence | `saveData` 3399, `persistNativeData` 3422, `applyNativeData` 3458 |
| Streamtime load and mapping | `initStreamtime` 3704, `_mapStJob` 3619, `_mapStCompany` 3691, `_getStWeekEntries` 3510, `_getStWeekAssignments` 3572, `seedWeekFromST` 3907 |
| 5-minute poll / cross-tab reload | `setInterval` 11807, `storage` listener 11822 |
| Workspace backup | `exportWorkspace` 2746, `importWorkspace` 2755 (`WORKSPACE_KEYS` 2745) |
| Identity | `MY_PERSON` / `currentPerson` hard-coded to `st_114330` (Ronan) at 2771–2772 |

## Run it locally

```bash
cd /path/to/CandCPlatform
python3 -m http.server 8000
# open http://localhost:8000/
```

- You need internet access. Even locally, the app reads **live production data** from `raw.githubusercontent.com/ronanheal/CandCPlatform/streamtime-data/*` (`ST_BASE`, `index.html:3487`), and fonts and libraries come from CDNs.
- `localStorage` belongs to one origin, so `localhost:8000` starts empty and doesn't share native data with the Vercel site. To test with real native data, export a workspace on the live site (Settings → Data) and import it locally. Note that the export leaves some keys out (DATA_MODEL.md §5).
- To work against a frozen dataset, copy the data branch files into a folder and point `ST_BASE` at that local path. `git show origin/streamtime-data:<file>.json` gets each file. `jobs.json` is 22 MB and `logged_times.json` is 53 MB.
- The sync scripts need `STREAMTIME_API_KEY`, which exists only as a GitHub secret. They write into `./streamtime-data/` relative to the working directory.

## The five things to know before reading on

1. **Native data is per-browser.** Everything created in the platform lives in the `localStorage` of whichever browser created it. Two staff members don't see each other's native jobs, quotes, clients or boards. Before cutover you have to *collect* it from each person's browser (SYNC_AND_MIGRATION.md §5).
2. **Many edits aren't durable even in that browser.** To Do board tasks are held only in memory and get rebuilt from Streamtime on every 5-minute poll. Several job edits on Streamtime-backed jobs (labels, members, notes, workflow stage, job-level quote and invoice fields, and phases or items added from the job-plan table) are dropped at the next sync. The full list is the durability matrix in DATA_MODEL.md §4.
3. **The JSON export is not a complete copy of Streamtime.** `invoices.json` holds 83 invoices (Feb–Oct 2026), while 2,162 jobs show issued invoices. Logged time only goes back to Jul 2025. 1,345 archived jobs have no phases or items. Migrate from the ST API directly, never from the branch files (SYNC_AND_MIGRATION.md §3).
4. **There is no authentication and the data is public.** The repo is public, so `users.json` (staff emails, rates), `invoices.json`, `contacts.json` and the rest can be downloaded by anyone without auth. The app has no login, and "me" is hard-coded to Ronan (`index.html:2772`), so every activity entry is attributed to him. The backend needs real auth and has to take over hosting the data.
5. **The `db*` stubs cover only part of the API.** Nine stub functions exist, and `dbCreateJob` has no callers at all. Most writes go straight to objects and then call `saveData()`. API_CONTRACT.md lists every mutation path.

## Reading order

1. **This page.**
2. **[DATA_MODEL.md](DATA_MODEL.md)**, the most important doc. Covers every entity, Streamtime → internal field mappings, native-only fields, the durability matrix, every `localStorage` key, and data-quality issues seen in the real export.
3. **[API_CONTRACT.md](API_CONTRACT.md)**: the endpoints the backend must provide, each mapped to the `index.html` functions that need it.
4. **[SYNC_AND_MIGRATION.md](SYNC_AND_MIGRATION.md)**: how the Streamtime sync works and fails, what Streamtime holds that the platform doesn't, the mirror → validate → switch-off plan, and the pre-cutover checklist.
5. `ROADMAP.md` (repo root): feature history. Its "What's blocking Phase 3" item 1 is **out of date**. It says native writes are in-memory only, but v2.22.0 made most of them durable in `localStorage` (still per-browser). Treat its "Phase 3 pre-flight" paragraph as a summary. These docs are the full inventory.

## About line numbers

All `index.html:NNNN` references are to commit `b6f7efb`. Three more commits landed locally while these docs were being written. None are pushed, and none are reflected in the line numbers:
- `b9131cd` adds `scripts/jobs_slim.py`, which cuts `jobs.json` to only the fields `_mapStJob` reads (21.9 MB → 3.5 MB). Once deployed, `jobs.json` will **no longer contain** job contact, job lead, rate card, branch, item costing method and the other unmapped fields listed in DATA_MODEL.md §3.1/§3.3. That's one more reason to migrate from the ST API, not the files.
- `7399d25` is design-system CSS fixes.
- `7ee5329` changes native time entries: the follow-up "No thanks" button no longer logs time, `_logTimeFromFup` stamps the **local** date and adds `jobItemUser.jobItemId`. Entries created before this commit may be dated a day early (UTC) or be duplicates. See the SYNC_AND_MIGRATION.md §6 checklist.

 Other engineers are editing `index.html` at the time of writing, so lines will move. Function names are stable, so search for those. A frozen copy of the file at that commit: `git show b6f7efb:index.html`.
