#!/usr/bin/env python3
"""
Streamtime API sync script — staged detail fetching.

Every hourly run:
  1. Refreshes all top-level data (jobs, times, invoices, quotes, companies,
     contacts, users) — ~10 API calls total.
  2. Reads sync_progress.json from the data branch to find which job IDs
     already have phases+items fetched.
  3. Fetches phases+items for the next batch of jobs (BATCH_SIZE per run),
     merging results into jobs.json.
  4. Updates sync_progress.json so the next run continues from where this
     one stopped.

Rate limit: 720 req/hour.
  ~10 calls for top-level data
  BATCH_SIZE=300 jobs × 2 calls = 600 calls
  Total per run ≈ 610 — safely under 720.

With 2,400 jobs the full backfill takes ~8 hourly runs (~8 hours).
After all jobs have detail, subsequent runs still refresh top-level data
and re-fetch phases+items only for "In Play"/"Paused" jobs each time.

Requires STREAMTIME_API_KEY env var. Run via GitHub Actions on an hourly cron.
"""

import json
import os
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

API_BASE = "https://api.streamtime.net/v1"
ST_SUBDOMAIN = "https://contentco.app.streamtime.net/api/v1"
API_KEY = os.environ["STREAMTIME_API_KEY"]
OUT_DIR = Path("streamtime-data")
OUT_DIR.mkdir(exist_ok=True)

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}

CONCURRENCY = 8   # parallel phase/item fetches
RETRY_DELAY = 2   # seconds between retries
BATCH_SIZE = 300  # jobs to fetch detail for per run (~600 API calls)

errors = []


def get(path, base=API_BASE):
    req = urllib.request.Request(f"{base}{path}", headers=HEADERS)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f"  rate limited on {path}, waiting 30s...")
                time.sleep(30)
                continue
            if attempt < 2:
                time.sleep(RETRY_DELAY)
                continue
            errors.append({"resource": path, "error": f"HTTP {e.code}"})
            return None
        except Exception as e:
            if attempt < 2:
                time.sleep(RETRY_DELAY)
                continue
            errors.append({"resource": path, "error": str(e)})
            return None


def search(view_id, query="", additional_data=None):
    """Paginate through a search view and return all records."""
    all_records = []
    offset = 0
    limit = 1000
    body = {"query": query, "limit": limit}
    if additional_data:
        body["additionalData"] = additional_data

    while True:
        body["offset"] = offset
        data = json.dumps(body).encode()
        req = urllib.request.Request(
            f"{API_BASE}/search?search_view={view_id}",
            data=data,
            headers=HEADERS,
            method="POST",
        )
        result = None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    result = json.loads(resp.read())
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    print(f"  rate limited on search view={view_id}, waiting 30s...")
                    time.sleep(30)
                    continue
                if attempt < 2:
                    time.sleep(RETRY_DELAY)
                    continue
                errors.append({"resource": f"search?search_view={view_id}", "error": f"HTTP {e.code}"})
                return all_records
            except Exception as e:
                if attempt < 2:
                    time.sleep(RETRY_DELAY)
                    continue
                errors.append({"resource": f"search?search_view={view_id}", "error": str(e)})
                return all_records

        if result is None:
            break
        raw = result.get("searchResults", [])
        page = list(raw.values()) if isinstance(raw, dict) else raw
        all_records.extend(page)
        print(f"  view={view_id} offset={offset} got={len(page)} total={len(all_records)}")
        if len(page) < limit:
            break
        offset += limit

    return all_records


def fetch_job_detail(job):
    """Fetch phases and items for a single job and attach them inline."""
    jid = job["id"]
    phases = get(f"/jobs/{jid}/job_phases", base=ST_SUBDOMAIN) or []
    items = get(f"/jobs/{jid}/job_items", base=ST_SUBDOMAIN) or []
    phase_map = {p["id"]: {**p, "items": []} for p in phases}
    loose_items = []
    for item in items:
        pid = item.get("jobPhaseId")
        if pid and pid in phase_map:
            phase_map[pid]["items"].append(item)
        else:
            loose_items.append(item)
    job["phases"] = list(phase_map.values())
    job["looseItems"] = loose_items
    return job


def save(filename, data, previous=None):
    """Save data, but never overwrite with fewer records than we already have."""
    count = len(data) if isinstance(data, list) else 1
    if isinstance(data, list) and previous is not None:
        prev_count = len(previous) if isinstance(previous, list) else 0
        if count == 0 and prev_count > 0:
            print(f"  SKIPPED {filename} — API returned 0, keeping {prev_count} existing")
            return prev_count
        if count < prev_count * 0.5:
            print(f"  SKIPPED {filename} — {count} records vs {prev_count} existing (API error?), keeping existing")
            return prev_count
    path = OUT_DIR / filename
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    print(f"  saved {filename} ({count} records)")
    return count


def load_existing(filename):
    """Load an existing JSON file from the data dir, return [] or {} on miss."""
    path = OUT_DIR / filename
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            pass
    return []


# ── 1. Reference endpoints ────────────────────────────────────────────────────
print("Fetching reference endpoints...")
organisation = get("/organisation")
users = get("/users")
roles = get("/roles")
branches = get("/branches")
rate_cards = get("/rate_cards")

save("organisation.json", organisation or {})
save("users.json", users or [])
save("roles.json", roles or [])
save("branches.json", branches or [])
save("rate_cards.json", rate_cards or [])

# ── 2. All top-level job data ─────────────────────────────────────────────────
print("\nFetching all jobs (live + archived)...")
ALL_STATUSES = 'job_status in ["In Play","Complete","Paused","Archived"]'
fresh_jobs = search(7, query=ALL_STATUSES, additional_data=["company"])
print(f"  {len(fresh_jobs)} total jobs fetched")

# Safety: if jobs returned 0 (rate limit / API error), fall back to existing data
# and skip the detail fetch + progress update entirely this run.
existing_jobs = load_existing("jobs.json")
if len(fresh_jobs) == 0 and len(existing_jobs) > 0:
    print(f"  WARNING: API returned 0 jobs — keeping {len(existing_jobs)} existing and skipping this run")
    fresh_jobs = existing_jobs  # use existing so other saves still work
    skip_detail = True
else:
    skip_detail = False

existing_by_id = {j["id"]: j for j in existing_jobs if isinstance(j, dict)}

# Merge: fresh top-level data wins, but preserve any previously fetched phases/items
job_map = {}
for j in fresh_jobs:
    jid = j["id"]
    prev = existing_by_id.get(jid, {})
    if "phases" in prev:
        j["phases"] = prev["phases"]
        j["looseItems"] = prev.get("looseItems", [])
    job_map[jid] = j

# ── 3. Load progress and decide which jobs need detail this run ───────────────
progress_path = OUT_DIR / "sync_progress.json"
progress = {}
if progress_path.exists():
    try:
        progress = json.loads(progress_path.read_text())
    except Exception:
        pass

detail_done = set(progress.get("detail_done", []))
backfill_complete = progress.get("backfill_complete", False)

# Jobs that still need phases/items fetched — active jobs first, then rest
active_statuses = {"In Play", "Paused"}
active_jobs = [j for j in fresh_jobs if (j.get("jobStatus") or {}).get("name") in active_statuses]
needs_detail_active = [j for j in active_jobs if j["id"] not in detail_done]
needs_detail_rest   = [j for j in fresh_jobs if j["id"] not in detail_done and (j.get("jobStatus") or {}).get("name") not in active_statuses]
needs_detail = needs_detail_active + needs_detail_rest

if skip_detail:
    batch = []
    print(f"\nSkipping detail fetch (jobs API returned 0)...")
elif backfill_complete:
    batch = active_jobs
    print(f"\nBackfill complete — refreshing {len(batch)} active jobs' detail...")
else:
    batch = needs_detail[:BATCH_SIZE]
    print(f"\nBackfill mode: {len(detail_done)}/{len(fresh_jobs)} done, fetching next {len(batch)} (active first)...")

# ── 4. Fetch phases + items for this batch ────────────────────────────────────
fetched_count = 0
with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
    futures = {pool.submit(fetch_job_detail, job_map[j["id"]]): j["id"] for j in batch if j["id"] in job_map}
    for future in as_completed(futures):
        jid = futures[future]
        try:
            updated = future.result()
            job_map[jid] = updated
            detail_done.add(jid)
            fetched_count += 1
        except Exception as e:
            errors.append({"resource": f"job/{jid}", "error": str(e)})
        if fetched_count % 50 == 0 and fetched_count > 0:
            print(f"  phases/items: {fetched_count}/{len(batch)} done this run")

print(f"  phases/items: {fetched_count}/{len(batch)} done this run")

# Check if backfill is now complete
if not skip_detail:
    all_ids = {j["id"] for j in fresh_jobs}
    backfill_complete = len(all_ids) > 0 and all_ids.issubset(detail_done)
    if backfill_complete:
        print("  ✓ Backfill complete — all jobs now have phases+items")
    # Save progress only when we have real data
    progress = {
        "detail_done": list(detail_done),
        "backfill_complete": backfill_complete,
        "total_jobs": len(fresh_jobs),
        "detail_count": len(detail_done),
        "last_run": datetime.now(timezone.utc).isoformat(),
    }
    progress_path.write_text(json.dumps(progress, indent=2))
else:
    print("  Skipped progress update (no fresh jobs data)")

# ── 5. Other search views ─────────────────────────────────────────────────────
print("\nFetching other data...")
prev_logged_times = load_existing("logged_times.json")
prev_invoices     = load_existing("invoices.json")
prev_quotes       = load_existing("quotes.json")
prev_companies    = load_existing("companies.json")
prev_contacts     = load_existing("contacts.json")
prev_users        = load_existing("users.json")
prev_expenses     = load_existing("expenses.json")

logged_times = search(8)
invoices     = search(10)
quotes       = search(11)
companies    = search(12)
contacts     = search(13)
expenses     = search(9)   # view 9 = logged expenses (cost entries against jobs)

# ── 6. Save everything ────────────────────────────────────────────────────────
jobs = list(job_map.values())
counts = {
    "organisation": 1 if organisation else 0,
    "users":        save("users.json",        users or [],        prev_users),
    "roles":        save("roles.json",        roles or []),
    "branches":     save("branches.json",     branches or []),
    "rate_cards":   save("rate_cards.json",   rate_cards or []),
    "jobs":         save("jobs.json",         jobs),
    "logged_times": save("logged_times.json", logged_times,       prev_logged_times),
    "invoices":     save("invoices.json",     invoices,           prev_invoices),
    "quotes":       save("quotes.json",       quotes,             prev_quotes),
    "companies":    save("companies.json",    companies,          prev_companies),
    "contacts":     save("contacts.json",     contacts,           prev_contacts),
    "expenses":     save("expenses.json",     expenses,           prev_expenses),
}

meta = {
    "last_synced": datetime.now(timezone.utc).isoformat(),
    "record_counts": counts,
    "backfill_complete": backfill_complete,
    "detail_progress": f"{len(detail_done)}/{len(fresh_jobs)} jobs have phases+items",
    "errors": errors,
}
(OUT_DIR / "sync_meta.json").write_text(json.dumps(meta, indent=2))
print(f"\nDone. Synced at {meta['last_synced']}")
print(f"Record counts: {counts}")
print(f"Detail progress: {meta['detail_progress']}")
if errors:
    print(f"Errors ({len(errors)}): {errors[:5]}")
