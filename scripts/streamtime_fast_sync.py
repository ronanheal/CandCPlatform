#!/usr/bin/env python3
"""
Streamtime fast sync — logged_times + scheduled_todos only.

Why this exists: the Todo board's "Done" column is driven entirely by
logged_times (view 8, logged_time_status=2); "To Do" by scheduled_todos
(same view, logged_time_status=1). Neither has a separate "marked complete"
flag from Streamtime — done-ness IS "a logged time entry exists". The full
sync (streamtime_sync.py) only runs hourly because its job phase/item detail
backfill costs ~610 of our 720 req/hour budget. This script re-fetches just
the two cheap, fast-changing views so Done/To Do reflect Streamtime within
~15 minutes instead of up to an hour, without touching the job detail
backfill or its progress tracker.

Cost per run: ~10-15 API calls (well under the 720/hour limit even running
4x/hour alongside the hourly full sync).

Requires STREAMTIME_API_KEY env var. Run via GitHub Actions, every 15 min.
"""

import json
import os
import time
import urllib.request
import urllib.error
from pathlib import Path

API_BASE = "https://api.streamtime.net/v1"
API_KEY = os.environ["STREAMTIME_API_KEY"]
OUT_DIR = Path("streamtime-data")
OUT_DIR.mkdir(exist_ok=True)

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}

RETRY_DELAY = 2

errors = []


def search(view_id, query="", timeout=120):
    all_records = []
    offset = 0
    limit = 500
    body = {"query": query, "limit": limit}

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
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    result = json.loads(resp.read())
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    print(f"  rate limited on search view={view_id}, waiting 30s...")
                    time.sleep(30)
                    continue
                if attempt < 3:
                    time.sleep(RETRY_DELAY * (attempt + 1))
                    continue
                errors.append({"resource": f"search?search_view={view_id}", "error": f"HTTP {e.code}"})
                return all_records
            except Exception as e:
                if attempt < 3:
                    wait = RETRY_DELAY * (attempt + 1)
                    print(f"  timeout/error on view={view_id} offset={offset}, retrying in {wait}s... ({e})")
                    time.sleep(wait)
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


def load_existing(filename):
    path = OUT_DIR / filename
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            pass
    return []


def save(filename, data, previous):
    """Never overwrite with fewer records than we already have (rate-limit/error guard)."""
    count = len(data) if isinstance(data, list) else 0
    prev_count = len(previous) if isinstance(previous, list) else 0
    if count == 0 and prev_count > 0:
        print(f"  {filename}: got 0 records, keeping previous {prev_count}")
        return prev_count
    (OUT_DIR / filename).write_text(json.dumps(data, ensure_ascii=False))
    return count


prev_logged_times = load_existing("logged_times.json")
prev_scheduled = load_existing("scheduled_todos.json")

logged_times = search(8, timeout=180)

raw_scheduled = search(8, query="logged_time_status = 1", timeout=120)
scheduled_todos = [{
    "id": t.get("id"),
    "userId": t.get("userId"),
    "date": (t.get("date") or "")[:10],
    "minutes": t.get("minutes") or 0,
    "notes": t.get("notes"),
    "scheduleNotes": t.get("scheduleNotes"),
    "itemName": t.get("itemName"),
    "jobItemId": (t.get("jobItemUser") or {}).get("jobItemId"),
    "jobId": (t.get("job") or {}).get("id"),
    "jobNumber": (t.get("job") or {}).get("number"),
    "jobName": (t.get("job") or {}).get("name"),
    "isBillable": (t.get("job") or {}).get("isBillable", True),
} for t in raw_scheduled]

lt_count = save("logged_times.json", logged_times, prev_logged_times)
st_count = save("scheduled_todos.json", scheduled_todos, prev_scheduled)

print(f"\nFast sync done. logged_times={lt_count} scheduled_todos={st_count}")
if errors:
    print(f"Errors: {errors}")
