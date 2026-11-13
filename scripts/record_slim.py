"""
Slim raw Streamtime invoices (view 11), quotes (view 10) and logged expenses (view 9).

These views are now fetched for every job status (2,457 invoices, 1,434 quotes, 4,883
expenses as of Nov 2026, vs 46 / 76 / 234 before), so their per-record weight matters: the
browser downloads each file whole on every page load.

What's dropped, and why it's safe:
- Keys that are null. index.html only ever compares these with `!=null` / `==null` or
  `x||default`, and an absent key behaves exactly the same as null in all of those.
- Duplicate currency columns (invoiceCurrency*, jobCurrency*, quoteCurrency*,
  loggedExpenseCurrency*) and Xero/audit fields nothing in index.html reads (checked by grep).
- A nested invoice `company` object (branch, rates, addresses...) is cut to {id, name}; the
  front end reads only company.name.
Zero, False and empty strings are kept: `0` totals and `isBillable:false` carry meaning.
"""

DROP_PREFIXES = ("invoiceCurrency", "jobCurrency", "quoteCurrency", "loggedExpenseCurrency")
DROP_KEYS = {
    "externalInvoiceId", "externalAccountingPlatformName", "externalAccountingPlatformId",
    "externalCopyDatetime", "externalId", "createdDatetime", "exchangeRate", "currencySymbol",
}


def slim_record(r):
    if not isinstance(r, dict):
        return r
    out = {}
    for k, v in r.items():
        if v is None or k in DROP_KEYS or k.startswith(DROP_PREFIXES):
            continue
        if k == "company" and isinstance(v, dict):
            v = {"id": v.get("id"), "name": v.get("name")}
        out[k] = v
    return out
