#!/usr/bin/env python3
"""
Read-only reconciliation: Streamtime (live API) vs the platform's synced JSON
(the `streamtime-data` branch). Written for docs/review/2026-11-data-reconciliation.md.

    python3 scripts/reconcile_streamtime.py fetch  [--cache DIR]   # pull from Streamtime (paced)
    python3 scripts/reconcile_streamtime.py report [--cache DIR]   # compare, print tables

Safety
  * The API key is read at runtime from ~/.streamtime_key and only ever placed in the
    Authorization header. It is never printed, logged or written anywhere.
  * Requests are GET, except POST /v1/search — Streamtime's search views (the same ones the
    sync uses) only accept POST. They are read-only queries; the client refuses any other
    POST path and any other method (see _request()).
  * Paced (MIN_GAP seconds between calls), honours Retry-After, exponential backoff on 429,
    and a hard cap on total calls (MAX_CALLS) so it can't starve the production sync loop.

Raw responses are cached (as JSON, never with headers) in the cache dir, so `report` can be
re-run without touching the API. Default cache: $TMPDIR/st_reconcile_cache.
"""

import argparse
import collections
import json
import os
import random
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

API_BASE = "https://api.streamtime.net/v1"
TENANT_BASE = "https://contentco.app.streamtime.net/api/v1"  # job phases/items, as the sync uses
MIN_GAP = 1.6
MAX_CALLS = 220
REPO = Path(__file__).resolve().parent.parent

_SSL = ssl.create_default_context(cafile="/etc/ssl/cert.pem") if os.path.exists("/etc/ssl/cert.pem") else None
_calls = {"n": 0, "429": 0, "last": 0.0}


def _key():
    with open(os.path.expanduser("~/.streamtime_key")) as fh:
        return fh.read().strip()


def _request(method, url, body=None, timeout=180):
    if method == "POST":
        p = urllib.parse.urlparse(url)
        if not (url.startswith(API_BASE + "/search?") and p.path == "/v1/search"):
            raise RuntimeError("refusing non-search POST")
    elif method != "GET":
        raise RuntimeError("refusing non-GET method")
    backoff = 20
    for attempt in range(7):
        if _calls["n"] >= MAX_CALLS:
            raise RuntimeError(f"call cap {MAX_CALLS} reached")
        gap = time.time() - _calls["last"]
        if gap < MIN_GAP:
            time.sleep(MIN_GAP - gap)
        headers = {"Authorization": "Bearer " + _key(), "Content-Type": "application/json"}
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        _calls["n"] += 1
        _calls["last"] = time.time()
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=_SSL) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                _calls["429"] += 1
                ra = e.headers.get("Retry-After")
                wait = int(ra) if ra and ra.isdigit() else backoff
                wait = min(max(wait, 5), 300)
                print(f"    429 -> waiting {wait}s", file=sys.stderr)
                time.sleep(wait)
                backoff = min(backoff * 2, 300)
                continue
            # Never echo headers; the URL carries no secret.
            print(f"    HTTP {e.code} on {method} {url.split('?')[0]}", file=sys.stderr)
            if e.code >= 500 and attempt < 3:
                time.sleep(5 * (attempt + 1))
                continue
            return {"__error__": e.code}
        except Exception as e:  # timeouts
            print(f"    {type(e).__name__} on {url.split('?')[0]}", file=sys.stderr)
            if attempt < 3:
                time.sleep(5 * (attempt + 1))
                continue
            return {"__error__": str(type(e).__name__)}
    return {"__error__": "rate_limited"}


def get(path, base=API_BASE):
    return _request("GET", base + path)


def search_page(view, query="", offset=0, limit=500, additional=None):
    body = {"query": query, "limit": limit, "offset": offset}
    if additional:
        body["additionalData"] = additional
    return _request("POST", f"{API_BASE}/search?search_view={view}", body)


def _records(resp):
    raw = (resp or {}).get("searchResults", [])
    return list(raw.values()) if isinstance(raw, dict) else raw


def search_all(view, query="", additional=None, limit=500, max_pages=40):
    """All pages of a view. Returns (records, error, statistics-from-first-page)."""
    out, offset, stats = [], 0, None
    for _ in range(max_pages):
        resp = search_page(view, query, offset, limit, additional)
        if "__error__" in (resp or {}):
            return out, f"error {resp['__error__']} at offset {offset}", stats
        if stats is None:
            stats = resp.get("statistics")
        page = _records(resp)
        out.extend(page)
        print(f"  view {view} q={query[:50]!r} offset={offset} got={len(page)}", file=sys.stderr)
        if len(page) < limit:
            return out, None, stats
        offset += limit
    return out, "page cap", stats


def stats_only(view, query=""):
    resp = search_page(view, query, 0, 1)
    if "__error__" in (resp or {}):
        return {"__error__": resp["__error__"]}
    return resp.get("statistics") or {}


# ── fetch ─────────────────────────────────────────────────────────────────────────────────

def _months_back(n, today):
    y, m = today.year, today.month
    out = []
    for _ in range(n):
        start = date(y, m, 1)
        end = date(y + (m == 12), m % 12 + 1, 1)
        out.append((start, end))
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    return list(reversed(out))


def fetch(cache, plat):
    cache.mkdir(parents=True, exist_ok=True)

    def dump(name, obj):
        (cache / name).write_text(json.dumps(obj, ensure_ascii=False))

    def have(name):
        return (cache / name).exists()

    today = date.today()
    if not have("users.json"):
        dump("users.json", get("/users"))
    for view, name in ((11, "invoices"), (10, "quotes"), (12, "companies"), (13, "contacts"),
                       (9, "expenses"), (18, "milestones")):
        if not have(f"{name}.json"):
            recs, err, st = search_all(view)
            dump(f"{name}.json", {"records": recs, "error": err, "statistics": st})

    # Jobs: same query/additionalData as streamtime_sync.py
    if not have("jobs.json"):
        recs, err, st = search_all(7, 'job_status in ["In Play","Complete","Paused","Archived"]',
                                   additional=["company"])
        dump("jobs.json", {"records": recs, "error": err, "statistics": st})
    if not have("job_status_stats.json"):
        dump("job_status_stats.json", {s: stats_only(7, f'job_status in ["{s}"]')
                                       for s in ("In Play", "Paused", "Complete", "Archived")}
             | {"__unfiltered__": stats_only(7, "")})

    # Logged time: the sync's working recent-window filter, one calendar month at a time.
    # Probe whether an upper bound is honoured; if not, fetch with >= and cut client-side.
    if not have("lt_probe.json"):
        q = 'date >= "2026-09-01" and date < "2026-09-03"'
        r = search_page(8, q, 0, 50)
        ds = sorted(str(x.get("date"))[:10] for x in _records(r))
        dump("lt_probe.json", {"query": q, "n": len(_records(r)), "min": ds[:1], "max": ds[-1:],
                               "error": r.get("__error__") if isinstance(r, dict) else None})
    probe = json.loads((cache / "lt_probe.json").read_text())
    bounded = probe["n"] > 0 and probe["max"] and probe["max"][0] < "2026-09-03" and not probe["error"]
    for start, end in _months_back(13, today):
        name = f"lt_{start:%Y-%m}.json"
        if have(name):
            continue
        if bounded:
            q = f'date >= "{start}" and date < "{end}"'
        else:
            raise SystemExit("upper date bound not honoured; adjust strategy")
        recs, err, st = search_all(8, q, max_pages=20)
        dump(name, {"query": q, "records": recs, "error": err, "statistics": st})

    # Unfiltered view 8 (what the sweep walks) — first page only, to see its order/size.
    if not have("lt_unfiltered_p0.json"):
        r = search_page(8, "", 0, 500)
        dump("lt_unfiltered_p0.json", {"records": _records(r), "statistics": (r or {}).get("statistics")})
    if not have("lt_status_stats.json"):
        dump("lt_status_stats.json", {"status2": stats_only(8, "logged_time_status = 2"),
                                      "status1": stats_only(8, "logged_time_status = 1")})

    # Job items for ~30 In Play jobs (tenant API, GET) — same endpoint as fetch_job_detail.
    if not have("job_items.json"):
        jobs = json.loads((cache / "jobs.json").read_text())["records"]
        live = [j for j in jobs if (j.get("jobStatus") or {}).get("name") == "In Play"]
        rnd = random.Random(20261113)
        sample = rnd.sample(live, min(30, len(live)))
        out = {}
        for j in sample:
            out[str(j["id"])] = get(f"/jobs/{j['id']}/job_items", base=TENANT_BASE)
        dump("job_items.json", out)
    print(f"API calls this run: {_calls['n']} (429s: {_calls['429']})", file=sys.stderr)
    (cache / "_calls.log").open("a").write(
        f"{datetime.now(timezone.utc).isoformat()} calls={_calls['n']} 429={_calls['429']}\n")


ALL_JOBS = 'job_status in ["In Play","Complete","Paused","Archived"]'


def fetch_all_scope(cache, full_months=4):
    """Stage 2. Views 8-11 default to jobs that are not Archived. Re-query them scoped to every
    job status (the same filter the sync uses for view 7): statistics for each month, full
    records for the last `full_months` months of logged time."""
    def dump(name, obj):
        (cache / name).write_text(json.dumps(obj, ensure_ascii=False))

    def have(name):
        return (cache / name).exists()

    if not have("scope_stats.json"):
        dump("scope_stats.json", {
            f"view{v}_{lbl}": stats_only(v, q)
            for v in (8, 9, 10, 11)
            for lbl, q in (("default", ""), ("all", ALL_JOBS))})
    if not have("extra_stats.json"):
        dump("extra_stats.json", {"scheduled": stats_only(8, "logged_time_status = 1"),
                                  "assign": stats_only(17, 'job_status in ["In Play","Paused"]')})
    months = _months_back(13, date.today())
    if not have("lt_all_month_stats.json"):
        out = {}
        for start, end in months:
            out[f"{start:%Y-%m}"] = stats_only(8, f'date >= "{start}" and date < "{end}" and {ALL_JOBS}')
        dump("lt_all_month_stats.json", out)
    for start, end in months[-full_months:]:
        name = f"ltall_{start:%Y-%m}.json"
        if have(name):
            continue
        q = f'date >= "{start}" and date < "{end}" and {ALL_JOBS}'
        recs, err, st = search_all(8, q, max_pages=20)
        dump(name, {"query": q, "records": recs, "error": err, "statistics": st})
    # Expenses on archived jobs: statistics only (scope_stats) — 10 pages wasn't worth the budget.
    for v, name in ((11, "invoices_all"), (10, "quotes_all")):
        if not have(f"{name}.json"):
            recs, err, st = search_all(v, ALL_JOBS, max_pages=12)
            dump(f"{name}.json", {"records": recs, "error": err, "statistics": st})
    print(f"API calls this run: {_calls['n']} (429s: {_calls['429']})", file=sys.stderr)
    (cache / "_calls.log").open("a").write(
        f"{datetime.now(timezone.utc).isoformat()} stage2 calls={_calls['n']} 429={_calls['429']}\n")

# ── report ────────────────────────────────────────────────────────────────────────────────

def _load_platform(plat_dir):
    files = ("jobs logged_times invoices quotes expenses users companies contacts milestones "
             "job_assignments scheduled_todos sync_meta logged_times_sweep").split()
    out = {}
    for f in files:
        if plat_dir:
            out[f] = json.loads((Path(plat_dir) / f"{f}.json").read_text())
        else:
            raw = subprocess.run(["git", "-C", str(REPO), "show", f"origin/streamtime-data:{f}.json"],
                                 capture_output=True, check=True).stdout
            out[f] = json.loads(raw)
    return out


def _name(v):
    return v.get("name") if isinstance(v, dict) else v


def _tbl(head, rows):
    print("| " + " | ".join(head) + " |")
    print("|" + "---|" * len(head))
    for r in rows:
        print("| " + " | ".join("" if c is None else str(c) for c in r) + " |")
    print()


def _h(m):
    return f"{m / 60:,.1f}"


def report(cache, plat_dir):
    P = _load_platform(plat_dir)
    C = lambda n: json.loads((cache / n).read_text())  # noqa: E731
    now = datetime.now(timezone.utc)
    meta = P["sync_meta"]
    print(f"Generated {now:%Y-%m-%d %H:%M} UTC\n")
    last = datetime.fromisoformat(meta["last_synced"])
    print(f"Last full sync {meta['last_synced']} ({(now - last).total_seconds() / 60:.0f} min ago); "
          f"last sweep pass {P['logged_times_sweep'].get('last_complete_pass_at')}; "
          f"sync errors: {meta.get('errors')}\n")

    # 1. counts
    scope = C("scope_stats.json")
    jst = C("job_status_stats.json")
    rows = [
        ("jobs (view 7, all statuses)", len(C("jobs.json")["records"]), "", len(P["jobs"])),
        ("logged time (view 8)", scope["view8_default"]["matchedRecords"], scope["view8_all"]["matchedRecords"], len(P["logged_times"])),
        ("expenses (view 9)", scope["view9_default"]["matchedRecords"], scope["view9_all"]["matchedRecords"], len(P["expenses"])),
        ("quotes (view 10)", scope["view10_default"]["matchedRecords"], scope["view10_all"]["matchedRecords"], len(P["quotes"])),
        ("invoices (view 11)", scope["view11_default"]["matchedRecords"], scope["view11_all"]["matchedRecords"], len(P["invoices"])),
        ("companies (view 12)", len(C("companies.json")["records"]), "", len(P["companies"])),
        ("contacts (view 13)", len(C("contacts.json")["records"]), "", len(P["contacts"])),
        ("milestones (view 18)", len(C("milestones.json")["records"]), "", len(P["milestones"])),
        ("users (GET /users)", len(C("users.json")), "", len(P["users"])),
    ]
    print("## Counts\n")
    _tbl(["entity", "ST default view (non-archived jobs)", "ST all job statuses", "platform"], rows)

    # 2. logged time
    print("## Logged time\n")
    plt = P["logged_times"]
    pid = {x["id"]: x for x in plt}
    allm = C("lt_all_month_stats.json")
    rows = []
    for mon, st in allm.items():
        dflt = C(f"lt_{mon}.json")
        pm = [x for x in plt if (x.get("date") or "")[:7] == mon]
        pmin = sum(x.get("minutes") or 0 for x in pm)
        rows.append((mon, st.get("matchedRecords"), _h(st.get("totalMinutes", 0)),
                     dflt["statistics"]["matchedRecords"], _h(dflt["statistics"]["totalMinutes"]),
                     len(pm), _h(pmin),
                     f"{(pmin / st['totalMinutes'] * 100) if st.get('totalMinutes') else 0:.1f}%"))
    _tbl(["month", "ST entries (all jobs)", "ST hours (all jobs)", "ST entries (non-archived)",
          "ST hours (non-archived)", "platform entries", "platform hours", "platform % of ST hours"], rows)

    # id-level for the months we have full all-scope records for
    full = sorted(f.name[6:13] for f in cache.glob("ltall_*.json"))
    api = {}
    for mon in full:
        for x in C(f"ltall_{mon}.json")["records"]:
            api[x["id"]] = x
    rows = []
    for mon in full:
        a = {i for i, x in api.items() if x["date"][:7] == mon}
        p = {i for i, x in pid.items() if (x.get("date") or "")[:7] == mon}
        miss = a - p
        extra = p - a
        rows.append((mon, len(a), len(p), len(a & p), len(miss), _h(sum(api[i]["minutes"] for i in miss)),
                     len(extra), _h(sum(pid[i].get("minutes") or 0 for i in extra))))
    print("### ID-level, months with full records\n")
    _tbl(["month", "ST entries", "platform entries", "in both", "missing from platform", "missing hours",
          "platform-only (deleted/moved in ST)", "platform-only hours"], rows)

    # billable split (job.isBillable, as index.html reads it)
    rows = []
    for mon in full:
        def split(recs):
            b = sum(x.get("minutes") or 0 for x in recs if (x.get("job") or {}).get("isBillable") is not False)
            n = sum(x.get("minutes") or 0 for x in recs if (x.get("job") or {}).get("isBillable") is False)
            sell = sum(x.get("totalExTax") or 0 for x in recs if (x.get("job") or {}).get("isBillable") is not False)
            return b, n, sell
        ab, an, asell = split([x for x in api.values() if x["date"][:7] == mon])
        pb, pn, psell = split([x for x in plt if (x.get("date") or "")[:7] == mon])
        st = allm[mon]
        rows.append((mon, _h(ab), _h(pb), _h(an), _h(pn), f"{asell:,.0f}", f"{psell:,.0f}",
                     _h(st.get("billableTotalMinutes", 0)), _h(st.get("nonBillableTotalMinutes", 0))))
    print("### Billable split (job.isBillable)\n")
    _tbl(["month", "ST billable h", "platform billable h", "ST non-bill h", "platform non-bill h",
          "ST billable sell $", "platform billable sell $", "ST stats billable h", "ST stats non-bill h"], rows)

    # per person, last 3 full-record months
    users = {u["id"]: u.get("displayName") or f"{u.get('firstName')} {u.get('lastName')}" for u in P["users"]}
    per = collections.defaultdict(lambda: [0, 0, 0, 0])
    for x in api.values():
        if x["date"][:7] in full[-3:]:
            per[x["userId"]][0] += 1
            per[x["userId"]][1] += x["minutes"]
    for x in plt:
        if (x.get("date") or "")[:7] in full[-3:]:
            per[x["userId"]][2] += 1
            per[x["userId"]][3] += x.get("minutes") or 0
    rows = [(users.get(u, u), a, _h(b), c, _h(d), _h(d - b)) for u, (a, b, c, d) in
            sorted(per.items(), key=lambda kv: -kv[1][1])]
    print(f"### Per person, {full[-3]} to {full[-1]}\n")
    _tbl(["person", "ST entries", "ST hours", "platform entries", "platform hours", "diff h"], rows)

    # field-by-field sample
    rnd = random.Random(42)
    both = sorted(set(api) & set(pid))
    sample = rnd.sample(both, min(30, len(both)))
    F = [("date", lambda x: (x.get("date") or "")[:10]), ("minutes", lambda x: x.get("minutes")),
         ("userId", lambda x: x.get("userId")), ("job.number", lambda x: (x.get("job") or {}).get("number")),
         ("job.isBillable", lambda x: (x.get("job") or {}).get("isBillable")),
         ("itemName", lambda x: x.get("itemName")), ("notes", lambda x: x.get("notes")),
         ("totalExTax", lambda x: x.get("totalExTax"))]
    mism = []
    for i in sample:
        for k, f in F:
            if f(api[i]) != f(pid[i]):
                mism.append((i, k, f(pid[i]), f(api[i])))
    all_mism = collections.Counter()
    for i in both:
        for k, f in F:
            if f(api[i]) != f(pid[i]):
                all_mism[k] += 1
    print(f"### Sample of 30 entries: {len(mism)} field mismatches\n")
    _tbl(["id", "field", "platform", "Streamtime"], mism)
    print(f"All {len(both)} matched entries, mismatching fields: {dict(all_mism)}\n")
    ex = [i for i in both if (api[i].get("minutes") != pid[i].get("minutes"))][:10]
    _tbl(["id", "date", "platform min", "ST min"], [(i, api[i]["date"], pid[i]["minutes"], api[i]["minutes"]) for i in ex])

    # 3. invoices
    print("## Invoices\n")
    inv_all = C("invoices_all.json")["records"]
    pinv = {x["id"]: x for x in P["invoices"]}
    six = (date.today().replace(day=1) - timedelta(days=150)).replace(day=1).isoformat()
    by_m = collections.defaultdict(lambda: [0, 0.0, 0.0, 0.0, 0, 0.0, 0.0])
    for i in inv_all:
        m = (i.get("invoiceDate") or "")[:7]
        b = by_m[m]
        b[0] += 1; b[1] += i.get("totalAmountExTax") or 0; b[2] += i.get("totalAmountIncTax") or 0
        b[3] += i.get("amountPaidIncTax") or 0
        if i["id"] in pinv:
            b[4] += 1; b[5] += i.get("totalAmountExTax") or 0; b[6] += i.get("amountPaidIncTax") or 0
    rows = [(m, *[f"{v:,.2f}" if isinstance(v, float) else v for v in by_m[m]]) for m in sorted(by_m) if m >= "2025-11"]
    _tbl(["invoice month", "ST count", "ST ex GST", "ST inc GST", "ST paid inc", "platform count",
          "platform ex GST", "platform paid inc"], rows)
    st_status = collections.Counter(_name(i.get("invoiceStatus")) for i in inv_all if (i.get("invoiceDate") or "") >= six)
    print(f"ST invoice statuses since {six}: {dict(st_status)}\n")
    rows = []
    for i in sorted(inv_all, key=lambda x: x.get("invoiceDate") or ""):
        if (i.get("invoiceDate") or "") < six:
            continue
        p = pinv.get(i["id"])
        if p:
            diffs = [k for k in set(i) | set(p) if i.get(k) != p.get(k)]
            flag = "match" if not diffs else "DIFF: " + ",".join(sorted(diffs))
        else:
            flag = "MISSING (job archived)"
        rows.append((i.get("number"), i.get("invoiceDate"), (i.get("company") or {}).get("name"),
                     _name(i.get("invoiceStatus")), f"{i.get('totalAmountExTax') or 0:,.2f}",
                     f"{i.get('totalAmountIncTax') or 0:,.2f}", f"{i.get('amountPaidIncTax') or 0:,.2f}",
                     i.get("dueDate"), flag))
    _tbl(["number", "date", "client", "status", "ex GST", "inc GST", "paid inc", "due", "platform"], rows)

    # 4. quotes
    print("## Quotes\n")
    q_all = C("quotes_all.json")["records"]
    pq = {x["id"] for x in P["quotes"]}
    qs = collections.defaultdict(lambda: [0, 0.0, 0, 0.0])
    for q in q_all:
        s_ = _name(q.get("quoteStatus"))
        qs[s_][0] += 1; qs[s_][1] += q.get("totalAmountExTax") or 0
        if q["id"] in pq:
            qs[s_][2] += 1; qs[s_][3] += q.get("totalAmountExTax") or 0
    _tbl(["status", "ST count", "ST ex GST", "platform count", "platform ex GST"],
         [(k, v[0], f"{v[1]:,.2f}", v[2], f"{v[3]:,.2f}") for k, v in sorted(qs.items(), key=lambda kv: -kv[1][0])])
    recent_missing = [q for q in q_all if q["id"] not in pq and (q.get("quoteDate") or "") >= six]
    print(f"Quotes dated since {six} missing from platform: {len(recent_missing)} "
          f"({sum(q.get('totalAmountExTax') or 0 for q in recent_missing):,.2f} ex GST), statuses "
          f"{dict(collections.Counter(_name(q.get('quoteStatus')) for q in recent_missing))}\n")
    recent_inv_missing = [i for i in inv_all if i["id"] not in pinv and (i.get("invoiceDate") or "") >= six]
    print(f"Invoices dated since {six} missing from platform: {len(recent_inv_missing)} "
          f"({sum(i.get('totalAmountExTax') or 0 for i in recent_inv_missing):,.2f} ex GST, "
          f"unpaid balance inc {sum(i.get('balance') or 0 for i in recent_inv_missing):,.2f}), statuses "
          f"{dict(collections.Counter(_name(i.get('invoiceStatus')) for i in recent_inv_missing))}\n")
    print("## Job status totals (view 7 statistics)\n")
    pj = collections.Counter(_name(j.get("jobStatus")) for j in P["jobs"])
    _tbl(["status", "ST", "platform"], [(k, v.get("matchedRecords"), pj.get(k)) for k, v in jst.items() if k != "__unfiltered__"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fetch", "fetch2", "report"])
    ap.add_argument("--cache", default=os.path.join(tempfile.gettempdir(), "st_reconcile_cache"))
    ap.add_argument("--plat", default=None, help="dir with streamtime-data JSON (default: git show)")
    a = ap.parse_args()
    cache = Path(a.cache)
    if a.cmd == "fetch":
        fetch(cache, a.plat)
    elif a.cmd == "fetch2":
        fetch_all_scope(cache)
    else:
        report(cache, a.plat)


if __name__ == "__main__":
    main()
