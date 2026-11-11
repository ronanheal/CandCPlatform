# jobs.json slimming: proposal

Status: proposal only. Nothing in `index.html` or `scripts/` has been changed.
Data: `origin/streamtime-data:jobs.json` as of the 8 Nov 2026 19:40Z full sync (2,732 jobs).
Line numbers refer to `index.html` at local `main` (13,132 lines).

## TL;DR

| | raw | gzip -6 (wire) |
|---|---|---|
| Published today (`indent=2`, origin/main sync) | **21.89 MB** | **1.28 MB** |
| No indent (pending local commit b6f7efb, not yet on origin/main) | 15.26 MB | 1.06 MB |
| **Option B: `slim_job()`, all detail inline, `separators=(",",":")`** | **3.46 MB** | **395 KB** |
| Option B with b6f7efb's `save()` as is (default `", "`/`": "` separators) | 3.75 MB | 405 KB |
| Option C: B + detail inline only for active + closed in the last 180 days | 2.11 MB | 254 KB |
| ...plus the on-demand `jobs_detail_archive.json` (Option C) | 1.38 MB | 129 KB |

**Recommendation:** ship **Option B now**. It is a sync-only change, needs no change to `index.html`, and gives exactly the same `_mapStJob` output for all 2,732 jobs (verified). Plan **Option C** as a follow-up once the current `index.html` work has landed. Do the re-backfill of the 1,345 archived jobs that have lost their detail (see Finding 1) only after C is in place.

---

## 1. Raw fields the front end reads

`initStreamtime()` fetches `jobs.json` (3715) and runs `jobs=raw.map(_mapStJob)` (3773-3774). After that the raw array is dropped. No other code holds a raw job object: every later read is of the *mapped* job (`jobs[]`). The complete set of raw reads is therefore the body of `_mapStJob` (3619-3690).

I grepped every raw key in the data against `index.html`. The keys not listed below either never appear, or appear only in CHANGELOG strings or on other objects: `lt.job.number` reads logged_times, and `j.budget` at 6986 is the mapped/native job.

**Job**

| Field | Line(s) | Use |
|---|---|---|
| `id` | 3637, 3638 | `_stId`, id fallback |
| `number` | 3637 | job id |
| `name` | 3640 | |
| `company.name` | 3641 | |
| `jobStatus.name` | 3621 | status / workflowStatus / paused |
| `isBillable` | 3644 | `!==false` (so `false` must survive) |
| `jobLabels[].name` (or bare string) | 3645 | |
| `estimatedStartDate`, `estimatedEndDate` | 3649, 3650 | |
| `purchaseOrderNumber` | 3651 | |
| `users[].id` | 3653 | members |
| `totalIssuedInvoicesExTax` | 3623, 3686 | |
| `totalLoggedMinutes`, `totalPlannedMinutes` | 3625, 3626 | |
| `totalLoggedTimeExTax` | 3627 | |
| `finalBudget`, `totalPlannedTimeExTax`, `budget` | 3631-3632 | `finalBudget‖totalPlannedTimeExTax‖budget` |
| `totalLoggedExpensesExTax` | 3633 | |
| `totalPaidInvoicesExTax`, `totalAwaitingPaymentInvoicesExTax` | 3687, 3688 | |
| `phases[]`, `looseItems[]` | 3662, 3676-3677 | |

**Phase:** `id`, `name` (3669), `items` (3663), `jobPhaseStatus.name` / `status` (3664). *Neither status field exists in the data.*

**Item** (`phases[].items[]` and `looseItems[]`): `id`, `name`, `description` (3660), `totalLoggedMinutes`, `totalPlannedMinutes` (3656), `sellRate` (3657), `jobItemStatus.name` (3659, 3665), `status` (3665, fallback; absent in data), `estimatedStartDate`, `earliestStartDate`, `estimatedEndDate`, `latestEndDate` (3660).

Every read is of the form `x||default`, `x?.name` or `x!==false`. That means `null`, `""` and numeric `0` behave exactly like a missing key, so `slim_job()` drops them too. It keeps `false`, and it keeps non-empty strings such as `"0.00"`, which are truthy in JS and would change the `finalBudget‖…` fallback.

Fields that are never read include the following. Together they are 50%+ of the job object, excluding detail: `branch`, `contact`, `rateCard`, `createdUser`, `fullName`, the whole `company` object except `name` (`postalAddress` alone is 460 KB), the `users[].name` / `jobLabels[].id/jobId` envelopes, all `*Cost*`, `*Incomplete*`, `*Draft*`, `*Approved*` and `*Planned*Expenses*` totals, `jobLeadUserId`, `exchangeRate`, `jobCreatedDate`, `completedDate` and `archivedDate`. On items, 21 of 32 fields are unread: `timeAllocationMethod`, `costingMethod`, all `jobCurrency*`, `*SubItems`, `masterJobItemId`, `jobId`, `jobPhaseId`, `orderId`, `isBillable`, `completedDate`, `totalIncomplete*`, `totalScheduledUsers`, `totalJobItemRoles`, `totalPlannedTimeExTax` and `totalLoggedTimeExTax`.

## 2. Measurements

Figures marked "measured" were taken on `jobs.json` from the data branch. gzip is level 6, which is what CDNs typically use. The published file uses `indent=2` because origin/main's `save()` still writes `indent=2`; whitespace alone is 6.6 MB of the 21.9 MB.

### Where the bytes are (raw objects, no-indent re-dump of 15.26 MB)

| Job-level key | Bytes | Share |
|---|---|---|
| `phases` | 7.59 MB | 50.5% |
| `company` | 1.48 MB | 9.8% |
| `looseItems` | 1.09 MB | 7.3% |
| `branch` | 500 KB | 3.3% |
| `contact` | 482 KB | 3.2% |
| `users` | 473 KB | 3.2% |
| `jobLabels` | 331 KB | 2.2% |
| `rateCard` | 320 KB | 2.1% |
| ~30 money/minute totals | ~2.5 MB | ~17% |

Phase and item detail is **58%** of the file: 8,506 items at an average of **924 bytes each**. Of the 32 item fields, the largest are `timeAllocationMethod` (6.2%), `jobItemStatus` (4.9%, full `{id,name}` object), `costingMethod` (4.6%) and five `jobCurrency*` totals (~22% combined), none of which the front end reads. After slimming, an item averages ~210 bytes and a job's detail averages **1.48 KB**.

### Options

| Option | jobs.json raw | gzip | Extra file (on demand) | Front-end change |
|---|---|---|---|---|
| Today, published | 21.89 MB | 1.28 MB | – | – |
| Pending no-indent change (b6f7efb) | 15.26 MB | 1.06 MB | – | none |
| **B: `slim_job()`, all detail inline** | **3.46 MB** | **395 KB** | – | **none** |
| B + drop shadowed fallbacks (`earliestStartDate` when `estimatedStartDate` set, etc.) | 3.17 MB | 368 KB | – | none, but fragile; not recommended |
| C0: detail inline for In Play/Paused only (137 jobs) | 1.68 MB | 201 KB | 1.82 MB / 178 KB | yes |
| C90: active + closed ≤ 90 d (387 inline) | 2.11 MB | 254 KB | 1.39 MB / 130 KB | yes |
| **C180: active + closed ≤ 180 d (389 inline)** | **2.11 MB** | **254 KB** | **1.38 MB / 129 KB** | yes |
| C365: active + closed ≤ 365 d (400 inline) | 2.13 MB | 256 KB | 1.36 MB / 128 KB | yes |
| Summary only, no detail at all (lower bound) | 1.39 MB | 168 KB | – | – |

B accounts for 93% of the achievable raw reduction and 86% of the gzip reduction.

**Browser cost** (measured with Node/V8 by running the real `_mapStJob` extracted from `index.html`):

| | parse | peak (text + parsed) | parsed objects | retained after mapping |
|---|---|---|---|---|
| Today | 30 ms | 58 MB | 14.2 MB | 7.2 MB |
| B | 10 ms | 13 MB | 6.3 MB | 7.2 MB |
| C180 | 7 ms | 8 MB | 4.2 MB | 4.7 MB |

The raw array is garbage after `_mapStJob`. So B mostly removes **transient** load cost: about 45 MB of peak heap, the GC churn that comes with it, and two thirds of parse time. Steady-state heap does not change, because the mapped jobs are the same. Only C lowers the *retained* jobs heap, by about 2.5 MB, because cold jobs carry no phases. Most of the ~107 MB total heap comes from elsewhere: logged_times, which is being slimmed separately, and DOM/state.

**Growth caveat.** 1,345 archived jobs currently have no detail (Finding 1). If they are re-backfilled, Option B grows to about **5.4 MB / ~0.6 MB gzip**, and it keeps growing by about 1.5 KB per job (around 1.2 MB a year). Under C180, jobs.json grows by only ~0.3 MB (202 of those jobs fall in the hot window) and then stays roughly flat. The archive file absorbs the rest (~3.1 MB / ~0.29 MB gzip, fetched only on demand).

## 3. Who needs phases/items of a non-active job?

These are all the readers of mapped `j.phases` / `ph.items`:

| Reader | Lines | Which jobs | Needs cold detail? |
|---|---|---|---|
| Job detail: `openJobDetail` copies `j.phases` into the global `phases`. Every tab reads that copy: Plan `renderPhases` (8461+), Timeline `renderTimelineTab` (8093), Quote tab (8154), Invoice builder `renderInvoice` (9529), Xero CSV (9567), Progress `_jobTimeEntries` (7498), stats refresh (7298) | 7045-7049 | **any job**, archived included | **yes, the main case** |
| Quote/invoice doc preview `_docLineItemsHTML` ← `openQuoteDocPreview` 7957 / `openInvoiceDocPreview` 7977 | 7886 | the job behind any ST quote/invoice | in principle. Today all 89 quotes and 83 invoices point at hot jobs |
| Global search "Job plan items" | 10609-10613 | **all jobs** | yes, if archived plan items should be searchable |
| Todo modal: paused check / item datalist / item picker | 5827, 5848, 5870 | the job picker lists `status==='inplay'` only (5778) | no. Edge case: editing an old task whose job has since closed shows an empty item list |
| Reallocate-time item list | 7664 | `inplay` jobs only (7644) | no |
| `computeJobStats` phase walk | 7312 | non-ST jobs only (ST jobs return precomputed stats at 7308-7311) | no |
| Native overlay `persistNativeData` / `applyNativeData` (native phases, `itemDeltas` keyed by ST phase id) | 3434-3436, 3468-3469 | jobs with local edits | **hazard**, see below |
| `dbCreatePhase` / `dbCreateItem`, `saveData` mirror | 2652-2658, 3404-3406, 8645 | active job (detail open) | no, the detail is already loaded |

The following do **not** read phases: the jobs list (`renderJobs` 6765), Dashboard, Reporting (12012+) and Profitability. They use the precomputed `_loggedMins/_plannedSell/_stInvoiced/...` fields and `stLoggedTimes`. Slimming the summary fields changes none of these.

**Overlay hazard under lazy loading.** `applyNativeData` only re-applies `itemDeltas` when it finds the ST phase id in `j.phases` (3469). `persistNativeData` rebuilds the overlay for every *present* job from memory (3424-3437) and keeps previous entries only for *absent* jobs (3444-3448). If a cold job is loaded without phases, its local item edits are silently dropped from memory, and the next `saveData()` erases them from `cc_job_overlay` for good. Any version of Option C must carry the previous overlay's `itemDeltas` forward for jobs still marked `_detailPending`.

### Strategy

**Option B (now).** Apply `slim_job()` in the sync when writing jobs.json, with every job's detail inline, and land it together with the pending no-indent change (ideally also switching `save()` to `separators=(",", ":")`). This needs zero front-end change. The merge step stays correct: it copies `prev["phases"]` from the previous jobs.json, `slim_job` is idempotent, and it keeps `phases`/`looseItems` (even when empty) whenever they were fetched, because the merge uses `"phases" in prev` as its "already fetched" signal.

**Option C (follow-up): hot/cold tiers with a single on-demand archive file.**

*Sync side* (`streamtime_sync.py`):

- **Hot jobs.** A job is hot when it is In Play or Paused, or closed (latest of `completedDate`/`archivedDate`) within 180 days, or has no close date. These keep inline detail.
- **Cold jobs.** Write a summary-only record with `"detailIn":"archive"`. Their detail goes to `jobs_detail_archive.json` as `{ "<stId>": {"phases":[…],"looseItems":[…]} }`. A single root-level file needs no change to `sync_loop.sh`, because its `restore()`/`publish()` already handle `*.json`.
- **Merge.** The merge **must** look up previous detail in both files: `detail = prev if "phases" in prev else prev_archive.get(str(jid))`. Otherwise cold jobs lose their detail on the next run, and `detail_done` stops them being refetched.
- **Archive save guard.** `save()` only guards lists, so the archive dict needs its own shrink guard. For example, keep the previous file if the new one has fewer than 50% of its entries.
- **"API returned 0" fallback.** That path re-uses the published, slimmed jobs, which carry no close dates. `is_hot()` treats `detailIn=="archive"` as cold for this reason.
- **Window choice.** 90, 180 and 365 days cost almost the same today, so pick 180 days for comfort. Revisit after the re-backfill, when the window starts to matter.

*Front-end side* (`index.html`; sketch only, not implemented):

1. Split the phase mapping out of `_mapStJob` into `_mapStPhases(j)`. When `j.detailIn==='archive'`, set `_detailPending:true` and `phases:[]`.
2. Add `ensureJobDetail()`. It does one cached fetch of `jobs_detail_archive.json`. For each pending job it sets `phases=[..._mapStPhases(detail), ...localPhases]`, re-applies the overlay `itemDeltas` for that job, and clears `_detailPending`.
3. Hook it in three places. In `openJobDetail` (7045), render the shell, then await, then rebuild `phases` and re-render the active tab. In `openQuoteDocPreview` / `openInvoiceDocPreview`, await before `_docLineItemsHTML`. In global search, the first query fires `ensureJobDetail()` and re-runs the search when it resolves.
4. In `persistNativeData`, for a job with `_detailPending`, copy the previous overlay entry's `itemDeltas` (and `phases`) forward unchanged.
5. The 180-day window keeps the Todo pickers (inplay only) and all current quote/invoice previews on the hot path, so the archive is only fetched when someone opens or searches an old job.

**Rejected alternatives.**

- *Per-job detail files* (`jobs_detail/<id>.json`). The sync loop only copies root `*.json` files, the data branch gains 2.7k files, and the extra round-trip per job open buys little over one ~130 KB gzip archive.
- *Background prefetch of the archive after first paint.* It adds back the retained heap that C removes. It is acceptable if search over archived items has to be instant.
- *Short key names / columnar encoding.* gzip already captures most of that win, and it would make the file unreadable for debugging.

## 4. Proposed `slim_job()`

Prototype file: `/private/tmp/claude-502/-Users-ronan-Documents-Content-Co/c9b1bbbb-48c1-46c5-a26f-e0c84c96076d/scratchpad/work/slim_job.py`. Intended home: a new `scripts/job_slim.py`, or alongside `logged_times_sweep.slim()`.

```python
from datetime import date, timedelta

# Raw ST fields index.html's _mapStJob() reads (index.html:3619-3690). Nothing else in the
# front end touches a raw job: initStreamtime() maps jobs.json through _mapStJob and drops it.
JOB_SCALARS = (
    "id", "number", "name", "isBillable",
    "estimatedStartDate", "estimatedEndDate", "purchaseOrderNumber",
    "finalBudget", "totalPlannedTimeExTax", "budget",
    "totalLoggedMinutes", "totalPlannedMinutes",
    "totalLoggedTimeExTax", "totalLoggedExpensesExTax",
    "totalIssuedInvoicesExTax", "totalPaidInvoicesExTax", "totalAwaitingPaymentInvoicesExTax",
)
ITEM_SCALARS = (
    "id", "name", "description", "sellRate",
    "totalLoggedMinutes", "totalPlannedMinutes",
    "estimatedStartDate", "estimatedEndDate", "earliestStartDate", "latestEndDate",
    "status",  # read as a fallback for jobItemStatus (index.html:3665); absent in today's data
)
PHASE_SCALARS = ("id", "name", "status")  # status: fallback for jobPhaseStatus (3664); absent today


def _keep(v):
    # Drop values the front end treats exactly like "missing": every read is `x||default`,
    # `x?.name`, or `x!==false`, so None / "" / numeric 0 behave identically to an absent key.
    # False is kept (isBillable!==false), and so are non-empty strings such as "0.00", which
    # are truthy in JS and would change `finalBudget||totalPlannedTimeExTax` fallbacks.
    if v is None or v == "":
        return False
    if isinstance(v, (int, float)) and not isinstance(v, bool) and v == 0:
        return False
    return True


def _named(o):
    """{..., "name": X} -> {"name": X}; passes through the bare-string label form."""
    if isinstance(o, dict):
        return {"name": o["name"]} if _keep(o.get("name")) else None
    return o if _keep(o) else None


def _pick(src, keys):
    return {k: src[k] for k in keys if k in src and _keep(src[k])}


def slim_item(it):
    out = _pick(it, ITEM_SCALARS)
    st = _named(it.get("jobItemStatus"))
    if st:
        out["jobItemStatus"] = st
    return out


def slim_phase(ph):
    out = _pick(ph, PHASE_SCALARS)
    st = _named(ph.get("jobPhaseStatus"))
    if st:
        out["jobPhaseStatus"] = st
    out["items"] = [slim_item(it) for it in ph.get("items") or []]
    return out


def slim_job(j, with_detail=True):
    """Reduce a raw view-7 job (+ fetch_job_detail phases/looseItems) to what index.html reads.

    Idempotent: slim_job(slim_job(j)) == slim_job(j), so it is safe to run on the previous
    jobs.json during the sync's merge step (the file shrinks on the first run, like
    logged_times_sweep.slim()).

    `phases`/`looseItems` are kept whenever present, even when empty: the sync's merge step
    uses `"phases" in prev` to know a job's detail was already fetched.
    with_detail=False drops them (summary-only record for the cold tier).
    """
    out = _pick(j, JOB_SCALARS)
    for k in ("company", "jobStatus"):
        v = _named(j.get(k))
        if v:
            out[k] = v
    labels = [x for x in (_named(l) for l in j.get("jobLabels") or []) if x]
    if labels:
        out["jobLabels"] = labels
    users = [{"id": u["id"]} for u in j.get("users") or [] if isinstance(u, dict) and u.get("id") is not None]
    if users:
        out["users"] = users
    if with_detail and "phases" in j:
        out["phases"] = [slim_phase(p) for p in j.get("phases") or []]
        out["looseItems"] = [slim_item(it) for it in j.get("looseItems") or []]
    return out


# ── Tiering (Option C) ────────────────────────────────────────────────────────
HOT_STATUSES = {"In Play", "Paused"}
HOT_DAYS = 180  # Complete/Archived jobs closed within this window keep inline detail


def is_hot(j, today=None, hot_days=HOT_DAYS):
    """Call on the RAW job (slim_job drops completedDate/archivedDate). A record already
    tiered cold by a previous run (the sync's "API returned 0" fallback re-uses the published
    file) stays cold rather than defaulting to hot for lack of dates."""
    if j.get("detailIn") == "archive":
        return False
    status = (j.get("jobStatus") or {}).get("name")
    if status in HOT_STATUSES or status is None:
        return True
    closed = max(filter(None, (j.get("completedDate"), j.get("archivedDate"))), default=None)
    if not closed:
        return True  # unknown close date: err on the side of inline detail
    cutoff = ((today or date.today()) - timedelta(days=hot_days)).isoformat()
    return closed[:10] >= cutoff
```

### Wiring for Option B (`streamtime_sync.py`, section 6)

```python
from job_slim import slim_job
...
jobs = [slim_job(j) for j in job_map.values()]
# b6f7efb's save() drops indent=2 but keeps default ", " / ": " separators (3.75 MB);
# adding separators=(",", ":") to save()'s json.dumps gives the 3.46 MB figure.
```

The merge loop in section 2 needs no change. It copies `prev["phases"]` and `prev["looseItems"]`, which are already slim after the first run, and `slim_job` is idempotent.

### Wiring for Option C (sketch)

```python
ARCHIVE = "jobs_detail_archive.json"
prev_archive = load_existing(ARCHIVE)
prev_archive = prev_archive if isinstance(prev_archive, dict) else {}

# section 2 merge loop
for j in fresh_jobs:
    jid = j["id"]
    prev = existing_by_id.get(jid, {})
    detail = prev if "phases" in prev else prev_archive.get(str(jid))
    if detail is not None:
        j["phases"] = detail["phases"]
        j["looseItems"] = detail.get("looseItems", [])
    job_map[jid] = j

# section 6
jobs, archive = [], {}
for j in job_map.values():
    if "phases" not in j or is_hot(j):
        jobs.append(slim_job(j))
    else:
        s = slim_job(j)
        archive[str(j["id"])] = {"phases": s.pop("phases"), "looseItems": s.pop("looseItems")}
        s["detailIn"] = "archive"
        jobs.append(s)
if len(archive) < 0.5 * len(prev_archive):          # save() only guards lists
    archive = prev_archive
(OUT_DIR / ARCHIVE).write_text(json.dumps(archive, ensure_ascii=False, separators=(",", ":")))
```

## 5. Verification (run on the real jobs.json)

Two independent checks were run. Both passed.

1. **Field walk** (`check_fields.py`). For each of 2,732 jobs, 2,366 phases and 8,506 items, every field path from §1 (20 job, 4 phase, 12 item paths) is compared between raw and `slim_job()` output. A field may differ only when the raw value is JS-falsy and the slim one is missing. The check also confirms that phase, item and `looseItems` counts are unchanged, that `phases`/`looseItems` presence is unchanged, and that `slim_job(slim_job(j)) == slim_job(j)`.
   ```
   checked 2732 jobs, 2366 phases, 8506 items; 20 job + 4 phase + 12 item field paths
   paths never present in raw data: ['phase.jobPhaseStatus.name', 'phase.status', 'item.status']
   errors: 0
   ```
2. **Behavioural equivalence** (`equiv.mjs`). The real `_mapStJob` and `_stFmtH` are extracted from `index.html` at run time and run on every raw job and its slimmed copy. The serialised outputs are compared.
   ```
   _mapStJob output identical for 2732/2732 jobs (0 diffs)
   ```

The scripts are in `/private/tmp/claude-502/-Users-ronan-Documents-Content-Co/c9b1bbbb-48c1-46c5-a26f-e0c84c96076d/scratchpad/work/`: `slim_job.py`, `check_fields.py`, `equiv.mjs`, `measure.py` and `heap.mjs`. To rerun:

```
python3 -I check_fields.py ../jobs.json .
node equiv.mjs /Users/ronan/CandCPlatform/index.html ../jobs.json jobs_slim.json
```

If the front end starts reading a new raw field, add it to `JOB_SCALARS`/`ITEM_SCALARS` and to the paths in `check_fields.py`. The `equiv.mjs` check will catch any omission automatically, because it runs the live `_mapStJob`.

## Findings along the way

1. **Half the archived jobs have lost their phase/item detail, and the sync will never refetch it.** 1,345 of 2,553 archived jobs have no `phases` key, including 444 closed in 2026. Yet `sync_progress.json` reports `backfill_complete: true` with 2,742 ids in `detail_done`, so those jobs are never re-queued. Their Plan, Timeline and Quote tabs currently render empty. The fix is to remove from `detail_done` any id whose job lacks `phases`, which lets the backfill refill them at about 2 calls per job, roughly 5 hourly runs. Do this **after** Option C, or Option B's jobs.json grows by about 2 MB.
2. **ST phases carry no status.** `/jobs/{id}/job_phases` returns only `id, jobId, name, orderId`. `ph.jobPhaseStatus?.name||ph.status` (3664) is therefore always empty, so ST phases never show as "complete". They are "paused" only through the all-items-paused rule. This predates the slimming and is unaffected by it. `slim_job` passes either field through if ST ever adds one.
3. **The no-indent change has not reached origin/main yet.** Local `main` is at b6f7efb, one commit ahead of origin/main at 183bfdc, whose `save()` still writes `indent=2`. That is why the published file is 21.9 MB rather than 15.3 MB. b6f7efb also keeps the default `", "`/`": "` separators. Switching to `separators=(",", ":")` saves another ~8% raw on every file, though only ~2-5% after gzip.
