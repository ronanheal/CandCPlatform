"""
Order-independent fetch of Streamtime logged time (search view 8). Shared by
streamtime_sync.py (hourly) and streamtime_fast_sync.py (every 15 min).

Why this exists: until late Sep 2026 view 8 paged newest-first, so a fetch that the rate
limit cut off after a page or two still caught the latest entries. Around 28 Sep - 1 Oct
2026 Streamtime switched the view's default order to job-grouped. The same cut-off fetch
then kept re-reading the first ~3,000 records (older, low-numbered jobs) and new time on
current jobs stopped arriving: ~10% of October was captured, and nothing new by November.
The truncation was also silent (four 429s in a row fell out of the retry loop as a normal
end of results), so sync_meta.json reported no errors throughout.

sweep() doesn't care what order Streamtime uses. It walks the whole view a bounded number
of pages per cycle, resuming from a cursor saved in logged_times_sweep.json and wrapping to
offset 0 after the last page. Every record is re-read once per pass and union-merged by id.
Pages overlap by OVERLAP records because under job-grouped order new entries insert
mid-list and push later records to higher offsets between one page read and the next.

recent() is the low-latency path for the To Do board's Done column. Each hourly run,
probe_recent_queries() tries a few candidate filters with a single small request and keeps
the first that demonstrably returns only recent records (a date filter, or newest-first
order under a status filter). If none works the sweep alone still gets everything, just
with up to one pass of delay.

slim() keeps only the fields index.html reads. Raw records carry a full copy of the job
(company, rate card, branch...) — ~80% of the old 5 KB/record — which would make a
complete dataset far too big for the browser to download on every page load.
"""

import json
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone

PAGE = 500
OVERLAP = 50           # each step advances 450, absorbing entries inserted mid-list
SKIP_AFTER_FAILS = 3   # a page failing 3 cycles running is skipped so it can't stall the pass
RECENT_DAYS = 21       # window the recent() fast path keeps fully up to date
RECENT_MAX_PAGES = 8


def slim(lt):
    """Reduce a raw view-8 record to the fields the platform reads (see module docstring)."""
    job = lt.get("job") or {}
    jiu = lt.get("jobItemUser") or {}
    st = lt.get("loggedTimeStatus")
    return {
        "id": lt.get("id"),
        "userId": lt.get("userId"),
        "date": lt.get("date"),
        "minutes": lt.get("minutes"),
        "notes": lt.get("notes"),
        "scheduleNotes": lt.get("scheduleNotes"),
        "itemName": lt.get("itemName"),
        "totalExTax": lt.get("totalExTax"),
        "completedDatetime": lt.get("completedDatetime"),
        "loggedTimeStatus": {"name": st.get("name")} if isinstance(st, dict) else st,
        "job": {k: job.get(k) for k in ("id", "number", "name", "isBillable")} if job else None,
        "jobItemUser": {"jobItemId": jiu.get("jobItemId")} if jiu else None,
    }


def _now():
    return datetime.now(timezone.utc).isoformat()


def _post_page(api_base, headers, query, offset, limit, timeout):
    body = json.dumps({"query": query, "limit": limit, "offset": offset}).encode()
    req = urllib.request.Request(f"{api_base}/search?search_view=8", data=body,
                                 headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = json.loads(resp.read()).get("searchResults", [])
    return list(raw.values()) if isinstance(raw, dict) else raw


def _fetch(api_base, headers, query, offset, limit, timeout):
    """One page with retries. Returns (records, None) or (None, reason). On a 429 it waits
    once, then yields with "rate_limited" instead of burning the hourly budget retrying."""
    reason = None
    for attempt in range(3):
        try:
            return _post_page(api_base, headers, query, offset, limit, timeout), None
        except urllib.error.HTTPError as e:
            if e.code == 429:
                if attempt == 0:
                    time.sleep(30)
                    continue
                return None, "rate_limited"
            reason = f"HTTP {e.code}"
        except Exception as e:  # timeouts, connection resets, bad JSON
            reason = f"{type(e).__name__}: {e}"
        if attempt < 2:
            time.sleep(3 * (attempt + 1))
    return None, reason


def _merge(by_id, records):
    added = 0
    for lt in records:
        i = lt.get("id")
        if i is None:
            continue
        if i not in by_id:
            added += 1
        by_id[i] = slim(lt)  # fresh copy wins: picks up edited minutes/notes
    return added


def _load(path):
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def sweep(api_base, headers, state_path, by_id, max_pages, errors, timeout=180):
    """Advance the full-view pass by up to max_pages pages, merging into by_id."""
    state = _load(state_path)
    offset = int(state.get("offset", 0))
    fails = int(state.get("fails_at_offset", 0))
    pages = added = 0
    stop = "page_budget"
    while pages < max_pages:
        page, reason = _fetch(api_base, headers, "", offset, PAGE, timeout)
        if page is None:
            if reason == "rate_limited":
                stop = "rate_limited"  # resume from here next cycle; not this page's fault
                break
            fails += 1
            errors.append({"resource": "logged_times sweep",
                           "error": f"{reason} at offset {offset} (attempt {fails})"})
            if fails >= SKIP_AFTER_FAILS:
                offset += PAGE - OVERLAP
                fails = 0
                state["skipped_pages"] = int(state.get("skipped_pages", 0)) + 1
            stop = "error"
            break
        fails = 0
        pages += 1
        added += _merge(by_id, page)
        if len(page) < PAGE:  # last page: a full pass is complete
            state["total"] = offset + len(page)
            state["last_complete_pass_at"] = _now()
            state["passes_completed"] = int(state.get("passes_completed", 0)) + 1
            state["skipped_pages_last_pass"] = int(state.get("skipped_pages", 0))
            state["skipped_pages"] = 0
            offset = 0
            stop = "pass_complete"
            break
        offset += PAGE - OVERLAP
    state.update({"offset": offset, "fails_at_offset": fails, "last_cycle_at": _now(),
                  "last_cycle_pages": pages, "last_cycle_added": added, "last_cycle_stop": stop})
    state_path.write_text(json.dumps(state, indent=2))
    print(f"  logged_times sweep: {pages} pages, +{added} new, stop={stop}, "
          f"next offset={offset}, last full pass={state.get('last_complete_pass_at') or 'never'}")
    return state


def probe_recent_queries(api_base, headers, state_path, errors, timeout=60):
    """Find a query that returns only recent logged time. One 50-record request per
    candidate, once an hour. The result is stored in the sweep state for recent()."""
    state = _load(state_path)
    since = (date.today() - timedelta(days=RECENT_DAYS)).isoformat()
    # Stored as templates: recent() renders {since} fresh each call, so the window never
    # drifts between hourly probes.
    candidates = [
        ("date_filter", 'date >= "{since}"'),
        ("date_filter", "date >= {since}"),
        ("date_filter", 'date > "{since}"'),
        ("newest_first", "logged_time_status = 2"),
        ("newest_first", ""),
    ]
    found, results, rate_limited = None, [], False
    for kind, tpl in candidates:
        q = tpl.format(since=since)
        page, reason = _fetch(api_base, headers, q, 0, 50, timeout)
        if page is None:
            results.append({"query": q, "error": reason})
            if reason == "rate_limited":
                rate_limited = True
                break
            continue
        ds = sorted(str(lt.get("date") or "")[:10] for lt in page if lt.get("date"))
        ok = bool(ds) and (ds[0] >= since if kind == "date_filter"
                           else ds[-1] >= (date.today() - timedelta(days=3)).isoformat()
                           and ds[0] >= (date.today() - timedelta(days=60)).isoformat())
        results.append({"query": q, "kind": kind, "count": len(page),
                        "min_date": ds[0] if ds else None, "max_date": ds[-1] if ds else None,
                        "works": ok})
        if ok:
            found = {"query": tpl, "kind": kind}
            break
    if found is None and rate_limited:
        found = state.get("recent_query")  # inconclusive probe: keep the last known-good query
    state["recent_query"] = found
    state["recent_probe"] = {"at": _now(), "results": results, "inconclusive": rate_limited}
    state_path.write_text(json.dumps(state, indent=2))
    print(f"  logged_times recent-query probe: {found['query'] if found else 'none works — sweep only'}")
    return found


def recent(api_base, headers, state_path, by_id, errors, timeout=120):
    """Fetch the last RECENT_DAYS days using the probed query, if one works."""
    found = _load(state_path).get("recent_query")
    if not found:
        return 0
    cutoff = (date.today() - timedelta(days=RECENT_DAYS)).isoformat()
    query = found["query"].format(since=cutoff)
    added = 0
    for p in range(RECENT_MAX_PAGES):
        page, reason = _fetch(api_base, headers, query, p * PAGE, PAGE, timeout)
        if page is None:
            if reason != "rate_limited":
                errors.append({"resource": "logged_times recent", "error": f"{reason} page {p}"})
            break
        added += _merge(by_id, page)
        if len(page) < PAGE:
            break
        # Newest-first mode has no server-side window: stop once a page is entirely older.
        if found["kind"] == "newest_first":
            ds = [str(lt.get("date") or "")[:10] for lt in page if lt.get("date")]
            if ds and max(ds) < cutoff:
                break
    print(f"  logged_times recent ({found['kind']}): +{added} new")
    return added
