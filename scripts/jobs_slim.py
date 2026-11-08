"""
Slim raw Streamtime jobs (view 7 + fetch_job_detail phases/items) to the fields index.html
reads. Same idea as logged_times_sweep.slim(): raw jobs carry ~32 fields per item and full
nested company/rate-card/branch objects the front end never touches.

Measured on the real export (Nov 2026): jobs.json 21.9 MB -> 3.46 MB raw (1.28 MB -> 395 KB
gzipped); browser peak memory during load 58 MB -> 13 MB. Verified: index.html's _mapStJob()
produces identical output for all 2,732 jobs from raw vs slimmed input. Full analysis, and a
proposed next step (cold-tier old jobs' detail into a lazily-fetched file), in
docs/audit/jobs-json-slimming.md.
"""

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
