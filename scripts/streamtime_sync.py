#!/usr/bin/env python3
"""
Streamtime API sync script.
Pulls all data from the Streamtime API and writes JSON files to ./streamtime-data/.
Run via GitHub Actions on a cron schedule; requires STREAMTIME_API_KEY env var.
"""

import json
import os
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

API_BASE = "https://api.streamtime.net/v1"
API_KEY = os.environ["STREAMTIME_API_KEY"]
OUT_DIR = Path("streamtime-data")
OUT_DIR.mkdir(exist_ok=True)

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}

errors = []


def get(path):
    req = urllib.request.Request(f"{API_BASE}{path}", headers=HEADERS)
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if attempt == 0:
                time.sleep(2)
                continue
            errors.append({"resource": path, "error": str(e)})
            return None
        except Exception as e:
            if attempt == 0:
                time.sleep(2)
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
        for attempt in range(2):
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    result = json.loads(resp.read())
                break
            except urllib.error.HTTPError as e:
                if attempt == 0:
                    time.sleep(2)
                    continue
                errors.append({"resource": f"search?search_view={view_id}", "error": str(e)})
                return all_records
            except Exception as e:
                if attempt == 0:
                    time.sleep(2)
                    continue
                errors.append({"resource": f"search?search_view={view_id}", "error": str(e)})
                return all_records

        raw = result.get("searchResults", [])
        # Some views return a dict keyed by ID rather than a list
        page = list(raw.values()) if isinstance(raw, dict) else raw
        all_records.extend(page)
        print(f"  view={view_id} offset={offset} got={len(page)} total={len(all_records)}")
        if len(page) < limit:
            break
        offset += limit

    return all_records


def save(filename, data):
    path = OUT_DIR / filename
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    count = len(data) if isinstance(data, list) else 1
    print(f"  saved {filename} ({count} records)")
    return count


print("Fetching simple endpoints...")
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

print("\nFetching search views...")
# view 7 = jobs, enriched with company data
jobs = search(7, additional_data=["company"])
# view 8 = logged times
logged_times = search(8)
# view 10 = invoices
invoices = search(10)
# view 11 = quotes
quotes = search(11)
# view 12 = companies
companies = search(12)
# view 13 = contacts
contacts = search(13)

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
    print(f"Errors: {errors}")
