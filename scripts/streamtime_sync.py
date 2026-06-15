#!/usr/bin/env python3
"""
Streamtime API sync script.
Pulls ALL data from the Streamtime API (live + archived) and writes JSON files
to ./streamtime-data/. Phases and items are fetched for every job using a
thread pool so the full pull completes in ~5 minutes.
Requires STREAMTIME_API_KEY env var. Run via GitHub Actions on a cron schedule.
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
# Use the Streamtime subdomain for endpoints that require it
ST_SUBDOMAIN = "https://contentco.app.streamtime.net/api/v1"
API_KEY = os.environ["STREAMTIME_API_KEY"]
OUT_DIR = Path("streamtime-data")
OUT_DIR.mkdir(exist_ok=True)

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}

CONCURRENCY = 10   # parallel requests for per-job detail fetches
RETRY_DELAY = 2    # seconds between retries

errors = []


def get(path, base=API_BASE):
    req = urllib.request.Request(f"{base}{path}", headers=HEADERS)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(10)
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
                    time.sleep(10)
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
    """Fetch phases and items for a single job and attach them."""
    jid = job["id"]
    phases = get(f"/jobs/{jid}/job_phases", base=ST_SUBDOMAIN) or []
    items = get(f"/jobs/{jid}/job_items", base=ST_SUBDOMAIN) or []
    # Nest items under their phase
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


def save(filename, data):
    path = OUT_DIR / filename
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    count = len(data) if isinstance(data, list) else 1
    print(f"  saved {filename} ({count} records)")
    return count


# ── Simple reference endpoints ────────────────────────────────────────────────
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

# ── All jobs — live + archived ────────────────────────────────────────────────
print("\nFetching all jobs (live + archived)...")
ALL_STATUSES = 'job_status in ["In Play","Complete","Paused","Archived"]'
jobs = search(7, query=ALL_STATUSES, additional_data=["company"])
print(f"  {len(jobs)} total jobs fetched")

# ── Per-job phases and items (parallel) ──────────────────────────────────────
print(f"\nFetching phases + items for all {len(jobs)} jobs ({CONCURRENCY} concurrent)...")
job_map = {j["id"]: j for j in jobs}
done = 0
with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
    futures = {pool.submit(fetch_job_detail, j): j["id"] for j in jobs}
    for future in as_completed(futures):
        try:
            updated = future.result()
            job_map[updated["id"]] = updated
        except Exception as e:
            errors.append({"resource": f"job/{futures[future]}", "error": str(e)})
        done += 1
        if done % 100 == 0 or done == len(jobs):
            print(f"  phases/items: {done}/{len(jobs)} done")

jobs = list(job_map.values())

# ── Other search views ────────────────────────────────────────────────────────
print("\nFetching other data...")
logged_times = search(8)
invoices = search(10)
quotes = search(11)
companies = search(12)
contacts = search(13)

# ── Save everything ───────────────────────────────────────────────────────────
counts = {
    "organisation": 1 if organisation else 0,
    "users": save("users.json", users or []),
    "roles": save("roles.json", roles or []),
    "branches": save("branches.json", branches or []),
    "rate_cards": save("rate_cards.json", rate_cards or []),
    "jobs": save("jobs.json", jobs),
    "logged_times": save("logged_times.json", logged_times),
    "invoices": save("invoices.json", invoices),
    "quotes": save("quotes.json", quotes),
    "companies": save("companies.json", companies),
    "contacts": save("contacts.json", contacts),
}

meta = {
    "last_synced": datetime.now(timezone.utc).isoformat(),
    "record_counts": counts,
    "errors": errors,
}
(OUT_DIR / "sync_meta.json").write_text(json.dumps(meta, indent=2))
print(f"\nDone. Synced at {meta['last_synced']}")
print(f"Record counts: {counts}")
if errors:
    print(f"Errors ({len(errors)}): {errors[:5]}")
