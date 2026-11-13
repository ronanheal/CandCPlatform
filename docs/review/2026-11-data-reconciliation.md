# Streamtime ↔ platform data reconciliation, 13 Nov 2026

Read-only comparison of the live Streamtime API with the JSON the platform loads from the `streamtime-data` branch (commit `9473d32`, fast sync 01:20 UTC; last full sync 00:35 UTC). Streamtime was queried between 01:38 and 01:52 UTC on 13 Nov 2026. The script is `scripts/reconcile_streamtime.py` (`fetch`, `fetch2`, then `report`).

## Headline

**Every record the sync fetches is copied faithfully.** Invoices, quotes, expenses, companies, contacts, milestones, users and all 2,748 jobs match Streamtime field for field. The only differences are about an hour of sync lag. The 30-entry logged-time sample had zero field mismatches.

**What the sync fetches is not the whole picture, though.** Streamtime search views 8, 9, 10 and 11 (logged time, expenses, quotes, invoices) return only records on jobs that are not Archived, unless the query says otherwise. The sync sends an empty query to every one of them. So when a job is archived, its invoices, quotes and expenses disappear from the platform. Its logged time stays only if a sweep had already captured it. C&C archives jobs soon after invoicing, so the money views are badly understated:

| What the user sees | Streamtime | Platform | Gap |
|---|---|---|---|
| Invoices, all time | 2,457 / $15.84M ex GST | 46 / $341.7k | 98% of invoices missing |
| Invoices dated Jun–Oct 2026 | 345 / $2.04M ex GST | 45 / $338.0k* | 300 invoices, **$1.70M ex GST** |
| Outstanding receivables (Awaiting Payment) | 75 / **$477.7k** balance | 33 / $297.1k | **42 invoices, $180.6k** |
| Overdue invoices (due before 13 Nov, unpaid) | 18 / $120.2k | 2 / $31.2k | **16 invoices, $89.0k overdue not shown** |
| Quotes, all time | 1,434 / $9.78M | 76 / $609.3k | 1,358 quotes; 194 dated since 1 Jun ($1.0M) |
| Expenses, all time | 4,883 / cost $6.52M / sell $7.09M | 234 / $120.2k / $185.7k | 4,649 expenses |
| Logged time, Aug–Nov 2026 | 11,909 entries / 7,452.5 h | 11,445 / 7,260.9 h | **471 entries, 200.0 h, $30.3k billable sell** missing (plus 7 deleted entries still on the platform) |
| Logged time, Nov 2025–May 2026 | 22,111 entries / 15,641 h | 2,695 / 2,324 h | the platform's history only starts around Apr–Jun 2026 |

\* The 46th platform invoice is from Feb 2026.

Job-level money is correct. Each job's invoiced, paid, awaiting, logged-sell and expense totals come from view 7, which the sync queries with every status, and all 2,748 jobs match. A job page's header numbers are therefore right, even where its invoice or quote list is empty.

## 1. Counts and freshness

| Entity | ST default view (non-archived jobs) | ST, all job statuses | Platform | Verdict |
|---|---|---|---|---|
| Jobs (view 7, queried with all statuses) | 2,748 | 2,748 | 2,748 | match (In Play 135, Paused 6, Complete 20, Archived 2,587 on both sides) |
| Logged time (view 8) | 9,420 | 119,229 | 20,280 | see §2 |
| Expenses (view 9) | 234 | 4,883 | 234 | matches default view; archived-job expenses never synced |
| Quotes (view 10) | 76 | 1,434 | 76 | same |
| Invoices (view 11) | 46 | 2,457 | 46 | same |
| Companies (view 12) | 102 | n/a | 102 | match, field for field (46 Active, 56 Archived) |
| Contacts (view 13) | 238 | n/a | 238 | match (120 Active, 118 Archived) |
| Milestones (view 18) | 6 | n/a | 6 | match |
| Users (`GET /users`) | 37 | n/a | 37 | match (16 Active, 19 Hibernated, 2 Deleted) |
| Scheduled to-dos (view 8, status 1) | 708 blocks / 585.7 h | n/a | 712 / 589.2 h | lag: blocks logged or removed since the 01:20 fast sync |
| Job assignments (view 17, In Play + Paused) | 2,154 | n/a | 2,153 | lag |

**Freshness.** The last full sync was 67 minutes before this check and the last fast sync 18 minutes before. The last complete logged-time sweep pass finished at 01:16 UTC (pass 40, 9,413 records, the size of the default view). `sync_meta.errors` shows one 429 on view 10 (quotes), and the keep-previous guard kept the quotes file, which is still identical to Streamtime. Sync lag accounts for every difference inside the synced scope:

- 12 In Play jobs show 10–120 minutes less logged time than Streamtime.
- 5 job items differ in logged minutes and 4 in end date. All were edited today.
- 7 logged-time entries on In Play jobs have not synced yet (1.7 h).

## 2. Logged time

### Per month, last 13 months (hours)

| Month | ST entries (all jobs) | ST hours | ST entries (non-archived) | Platform entries | Platform hours | Platform % of ST hours |
|---|---|---|---|---|---|---|
| 2025-11 | 3,892 | 2,294.8 | 0 | 0 | 0.0 | 0% |
| 2025-12 | 3,068 | 2,384.1 | 1 | 1 | 0.3 | 0% |
| 2026-01 | 2,393 | 2,206.8 | 2 | 16 | 7.1 | 0.3% |
| 2026-02 | 3,426 | 2,370.0 | 16 | 60 | 39.5 | 1.7% |
| 2026-03 | 3,836 | 2,477.8 | 5 | 133 | 104.8 | 4.2% |
| 2026-04 | 2,569 | 1,994.6 | 709 | 890 | 984.0 | 49.3% |
| 2026-05 | 2,927 | 1,913.2 | 571 | 1,595 | 1,188.4 | 62.1% |
| 2026-06 | 3,034 | 2,202.8 | 776 | 2,922 | 2,139.5 | 97.1% |
| 2026-07 | 3,208 | 2,266.2 | 673 | 3,216 | 2,273.2 | 100.3% |
| 2026-08 | 3,436 | 2,093.4 | 892 | 3,321 | 2,046.4 | 97.8% |
| 2026-09 | 3,357 | 2,284.5 | 1,330 | 3,159 | 2,201.1 | 96.3% |
| 2026-10 | 3,404 | 2,119.8 | 2,784 | 3,267 | 2,063.8 | 97.4% |
| 2026-11 (to 13th) | 1,712 | 954.8 | 1,661 | 1,698 | 949.6 | 99.5% |

Months before about June 2026 are almost absent. Those entries sit on jobs that were archived before the sync ever swept them, and the default view no longer returns them. The platform still holds 6,077 entries on now-archived jobs, but only because earlier passes captured them while those jobs were live. Jul 2026 shows 100.3% because 3 entries deleted in Streamtime are still on the platform (see below).

### ID-level, Aug–Nov 2026 (full records fetched from both sides)

| Month | ST entries | Platform | In both | Missing from platform | Missing hours | Platform-only (deleted in ST) | Platform-only hours |
|---|---|---|---|---|---|---|---|
| 2026-08 | 3,436 | 3,321 | 3,319 | 117 | 47.5 | 2 | 1.1 |
| 2026-09 | 3,357 | 3,159 | 3,157 | 200 | 86.3 | 2 | 2.0 |
| 2026-10 | 3,404 | 3,267 | 3,264 | 140 | 61.5 | 3 | 5.5 |
| 2026-11 | 1,712 | 1,698 | 1,698 | 14 | 4.7 | 0 | 0.0 |

**Oct/Nov 2026, the known backfill.** The sweep has recovered almost all of the Oct 2026 incident.

- **October:** Streamtime has 3,404 entries and 2,119.8 h; the platform has 3,267 entries and 2,063.8 h. 140 entries (61.5 h) are missing. All 140 are on jobs that are now Archived, and all are billable. 3 platform entries (5.5 h) were deleted in Streamtime. The net gap is 56.0 h (2.6%).
- **November to date:** Streamtime has 1,712 entries and 954.8 h; the platform has 1,698 entries and 949.6 h. 14 entries (4.7 h) are missing:
  - 7 are entries on In Play jobs (1.7 h). This is ordinary sync lag.
  - 7 are on archived jobs (3.0 h).

**Who is affected.** 464 of the 471 missing Aug–Nov entries (198.3 h) are on Archived jobs, worth $30,080 sell; all 471 total $30,253. Apart from 2 non-billable entries in November, every missing entry is billable. Their `completedDatetime` clusters on 26–31 Aug and 27 Sep–8 Oct. Those dates are month-end retainer close-outs, plus the 28 Sep–1 Oct window when view 8's order changed. The jobs were archived before a sweep pass reached the entries, and after that the default view hides them. The worst-hit jobs are:

| Job | Missing entries |
|---|---|
| 7165 Otaika October Retainer | 47 |
| 7087 DW/TF/RM September Retainer | 34 |
| 7054 Pie September Retainer | 24 |
| 6781 SFF July Costco | 19 |
| 6986 Harker Herbals | 18 |

### Billable split (`lt.job.isBillable`, as index.html reads it)

| Month | ST billable h | Platform billable h | ST non-billable h | Platform non-billable h | ST billable sell | Platform billable sell |
|---|---|---|---|---|---|---|
| 2026-08 | 1,568.6 | 1,521.7 | 524.8 | 524.8 | $241,337 | $234,256 |
| 2026-09 | 1,611.3 | 1,527.9 | 673.1 | 673.1 | $248,429 | $235,745 |
| 2026-10 | 1,407.2 | 1,351.2 | 712.5 | 712.5 | $215,052 | $206,231 |
| 2026-11 | 670.5 | 665.9 | 284.2 | 283.7 | $103,869 | $103,184 |

Non-billable hours match exactly, because the house-time jobs never get archived mid-year. The whole gap is billable client time. The platform's billable flag agrees with Streamtime's own billable and non-billable statistics, so the `isBillable` mapping is correct.

### Per person, Sep–Nov 2026

| Person | ST entries | ST hours | Platform entries | Platform hours | Diff (h) |
|---|---|---|---|---|---|
| ange | 854 | 452.9 | 825 | 447.1 | −5.8 |
| ronan | 357 | 437.2 | 347 | 428.5 | −8.8 |
| jb | 499 | 426.0 | 490 | 421.2 | −4.8 |
| bee | 369 | 415.9 | 364 | 411.2 | −4.8 |
| alejandro | 494 | 411.0 | 470 | 391.7 | −19.3 |
| dharni | 761 | 404.8 | 735 | 394.2 | −10.5 |
| charlotte | 952 | 404.1 | 922 | 394.6 | −9.5 |
| natasha | 899 | 403.4 | 868 | 387.8 | −15.6 |
| bianca | 917 | 389.4 | 829 | 357.2 | **−32.2** |
| maya | 931 | 374.6 | 894 | 365.1 | −9.5 |
| corine | 457 | 331.9 | 454 | 331.2 | −0.7 |
| shelleyh | 141 | 325.2 | 141 | 325.2 | 0.0 |
| harryross | 114 | 265.6 | 111 | 262.3 | −3.2 |
| ashlee | 600 | 196.5 | 551 | 181.3 | −15.2 |
| yash | 128 | 120.4 | 123 | 115.7 | −4.8 |

Utilisation and billable percentage in People and Reporting read 1–8% low for these people.

### Field-by-field

I drew a random sample of 30 entries present on both sides and compared date, minutes, user, job number, `job.isBillable`, item, notes and `totalExTax`. **There were 0 mismatches.**

Across all 11,438 matched Aug–Nov entries, 36 fields differ:

| Field | Mismatches |
|---|---|
| `totalExTax` | 24 |
| minutes | 7 |
| item | 7 |
| job number | 2 |
| notes | 2 |
| date | 1 |

Only one of these is on a live job: entry 53016211, edited today (90 → 120 min). This is lag. Every other mismatch is on an Archived job that was edited after archiving, which freezes the platform's copy:

- 17 entries on job 7206 were re-rated ($150 → $179.71/h).
- 2 entries were moved to a different job.
- 1 entry's date was changed (Aug 25 → 27).

**Deleted entries are never removed.** 7 platform entries no longer exist in Streamtime (ids 51042295, 51106024, 51740031, 51749356, 52286225, 52286226, 52286579; 8.6 h in total). Two of them are on In Play jobs, which the sweep re-reads every pass. `sweep()` only union-merges and never drops ids, so deleted or re-dated entries stay in the platform's totals indefinitely.

## 3. Invoices

The platform's 46 invoices are identical to Streamtime's records in every field, including totals, paid amounts, statuses, due dates and paid dates. Streamtime's view-11 statistics for the default scope also match: $341,731.01 ex GST, $385,379.79 inc GST, $86,745.95 paid. Everything else on invoices is missing.

| Invoice month | ST count | ST ex GST | ST inc GST | ST paid inc | Platform count | Platform ex GST | Platform paid inc |
|---|---|---|---|---|---|---|---|
| 2026-05 | 63 | 327,581.79 | 370,328.39 | 370,328.39 | 0 | 0 | 0 |
| 2026-06 | 78 | 545,888.57 | 618,359.20 | 618,359.20 | 2 | 8,100.00 | 9,315.00 |
| 2026-07 | 73 | 440,648.36 | 485,960.87 | 485,702.12 | 0 | 0 | 0 |
| 2026-08 | 66 | 332,620.54 | 370,738.85 | 366,041.10 | 2 | 27,025.00 | 31,078.75 |
| 2026-09 | 70 | 397,915.67 | 449,347.96 | 335,122.83 | 9 | 65,781.71 | 42,025.32 |
| 2026-10 | 58 | 319,827.35 | 359,021.82 | 0.00 | 32 | 237,061.80 | 0.00 |

(No invoices are dated November yet. Earlier months show the same pattern: 0 platform invoices for Nov 2025 to Jan 2026, against $1.18M in Streamtime.)

Between 1 Jun and 31 Oct 2026, Streamtime has 345 invoices ($2,036,900.49 ex GST): 270 Paid, 74 Awaiting Payment and 1 Draft. The platform has 45 of them ($337,968.51), all exact matches. The other **300 are missing** ($1,698,931.98 ex GST): 259 Paid and 41 Awaiting Payment.

**Unpaid invoices missing from the platform.** There are 42, with a $180,594.61 balance. 41 fall inside Jun–Oct; the 42nd is INV-3762 from 2024. 16 of them are already overdue ($88,973.48), so neither the Overdue invoices card nor the Invoices list shows them:

| Number | Date | Client | Ex GST | Balance | Due |
|---|---|---|---|---|---|
| INV-3762 | 2024-03-31 | Organic Initiative Corporation USA | 1,025.00 | 1,025.00 | 2024-04-20 |
| INV-5622 | 2026-07-31 | Silver Fern Farms | 1,975.00 | 258.75 | 2026-08-20 |
| INV-5696 | 2026-08-31 | Silver Fern Farms | 2,700.00 | 3,105.00 | 2026-09-20 |
| INV-5750 | 2026-08-31 | Silver Fern Farms | 1,385.00 | 1,592.75 | 2026-09-20 |
| INV-5756 | 2026-09-30 | Silver Fern Farms | 6,737.50 | 7,748.13 | 2026-10-20 |
| INV-5761 | 2026-09-30 | Silver Fern Farms | 5,500.00 | 6,325.00 | 2026-10-20 |
| INV-5762 | 2026-09-30 | 110 Luggate | 1,450.00 | 1,667.50 | 2026-10-20 |
| INV-5763 | 2026-09-30 | Avalanche Coffee Limited | 2,800.00 | 3,220.00 | 2026-10-20 |
| INV-5764 | 2026-09-30 | Avalanche Coffee Limited | 575.00 | 661.25 | 2026-10-20 |
| INV-5796 | 2026-09-30 | Recorp | 500.00 | 575.00 | 2026-10-20 |
| INV-5797 | 2026-09-30 | Recorp | 950.00 | 1,092.50 | 2026-10-20 |
| INV-5798 | 2026-09-30 | Recorp | 8,569.08 | 9,635.30 | 2026-10-20 |
| INV-5799 | 2026-09-30 | Ridgeburn Ltd | 2,597.89 | 2,987.57 | 2026-10-20 |
| INV-5808 | 2026-09-30 | Silver Fern Farms | 2,700.00 | 3,105.00 | 2026-10-20 |
| INV-5810 | 2026-09-30 | Silver Fern Farms | 6,750.00 | 7,012.50 | 2026-10-20 |
| INV-5813 | 2026-09-30 | The Collective - Epicurean | 33,880.20 | 38,962.23 | 2026-10-20 |

The other 26 missing unpaid invoices are dated 31 Oct and due 20 Nov ($91.6k). They include:

| Number | Client | Ex GST |
|---|---|---|
| INV-5858 | Harker Herbals | 20,221.58 |
| INV-5879 | Wedderspoon | 13,287.80 |
| INV-5827 | Silver Fern Farms | 4,676.44 |
| INV-5853 | The Collective | 4,750.00 |
| INV-5834 | Formthotics | 4,125.00 |

Run `python3 scripts/reconcile_streamtime.py report` for the full list. It also prints a field-by-field verdict for every Jun–Oct invoice.

**Where users see this:**

| Platform feature | index.html | Effect |
|---|---|---|
| Invoices list | 12688–12830 | missing invoices not listed |
| Overdue invoices card | 4775 | 2 shown ($31.2k) instead of 18 ($120.2k) |
| Due-date calendar | 10795 | missing invoices absent |
| Reporting revenue | 18162, 18597 | Sep 2026 shows $65.8k invoiced vs $397.9k actual; Aug $27.0k vs $332.6k |
| Client and job invoice tabs | n/a | empty for archived jobs |
| Job header totals | n/a | correct, because they come from jobs.json |

## 4. Quotes

The platform's 76 quotes match Streamtime field for field. They are the default view: $609,330.55 ex GST, $691,928.32 inc GST.

| Status | ST count | ST ex GST | Platform count | Platform ex GST |
|---|---|---|---|---|
| Approved | 561 | 3,380,683.62 | 19 | 148,913.91 |
| Draft | 506 | 3,195,258.44 | 33 | 233,305.00 |
| Pending Approval | 239 | 1,688,277.15 | 18 | 130,811.64 |
| Declined | 128 | 1,514,372.70 | 6 | 96,300.00 |

194 quotes dated since 1 Jun are missing ($1.0M ex GST): 78 Approved, 54 Pending, 50 Draft and 12 Declined. Most are on jobs that were archived after delivery. This matters little day to day, but it affects win-rate and pipeline reporting, the "awaiting quotes" attention card (4776), and quote history on archived jobs.

## 5. Jobs

Count by status matches exactly: In Play 135, Paused 6, Complete 20, Archived 2,587. I compared every field `_mapStJob` reads, using `jobs_slim.slim_job()` on the fresh Streamtime record against `jobs.json`, across all 2,748 jobs. The fields were number, name, client, status, billable, start and due dates, PO, finalBudget, totalPlannedTimeExTax, budget, planned and logged minutes, logged sell, expenses, and invoiced, paid and awaiting totals. Only 12 In Play jobs differ, and only in logged minutes and logged sell (10–120 min each, today's time), which is lag.

**Item level, 30 random In Play jobs (274 items).** Each job's item count matches. Planned minutes, sell rate and names match on every item. 5 items differ in logged minutes and 4 in `latestEndDate`, all on items touched today.

**Mapping note.** 48 old Archived jobs have no `number` field in Streamtime, because the number is embedded in the name (for example "4445 Supply of packaging files…"). `_mapStJob` uses `String(j.number||j.id)`, so these jobs show their internal ID (for example 1344745) as the job number. Only old archived jobs are affected.

## 6. Expenses

The 234 platform expenses match Streamtime field for field (cost $120,200.66, sell $185,745.54, both equal to Streamtime's statistics). Statuses are 155 Draft, 74 Approved and 5 Declined.

30 expenses have quantity ≠ 1. For every one, `totalExTax = quantity × sellRate` and `totalCost = quantity × costRate` hold in the data. The job expense tab (index.html:9817–9822) and the expense list (5178) read `totalExTax` as the line total and `sellRate` as the unit price, so quantity is handled correctly.

The same archived-job scoping applies: Streamtime has 4,883 expenses in total ($6.52M cost, $7.09M sell), and expenses on archived jobs are not in the platform.

## 7. Users, companies, contacts

Users, companies and contacts all match by count and field for field.

| Entity | Count | Status breakdown |
|---|---|---|
| Users | 37 | 16 Active, 19 Hibernated, 2 Deleted |
| Companies | 102 | 46 Active, 56 Archived |
| Contacts | 238 | 120 Active, 118 Archived; `active` is true on all 238 |

The index.html contact ranking uses `contactStatus` as well, which handles Archived contacts correctly.

## Causes, summarised

| # | Mismatch | Size | Cause | Users see it? |
|---|---|---|---|---|
| 1 | Invoices, quotes and expenses on archived jobs never synced | 2,411 invoices ($15.5M), 1,358 quotes, 4,649 expenses; **$180.6k receivables, 16 overdue invoices** | Views 9, 10 and 11 default to non-archived jobs; the sync sends `query=""` | **Yes**: Invoices, Overdue card, Reporting revenue, client history |
| 2 | Logged time on jobs archived before the sweep reached it | 464 entries / 198 h / $30.1k (Aug–Nov); nearly all pre-Jun 2026 | Same scoping on view 8. The sweep walks only the default view (9,413 rows), and jobs archived during the Oct ordering incident took their time with them | Yes: Reporting, People utilisation, billable % (1–8% low per person) |
| 3 | Edits after archiving not picked up | ~30 entries (re-rated, moved, re-dated) | Same: archived entries are never re-read | Minor |
| 4 | Deleted entries never removed | 7 entries / 8.6 h | `sweep()` union-merges by id and never prunes | Minor; grows over time |
| 5 | Today's time, to-dos and assignments | 7 entries, 12 jobs, 4 to-dos, 1 assignment | Normal sync lag (15–60 min) | Briefly |
| 6 | 48 jobs show their internal ID as the job number | 48 archived jobs | `_mapStJob` fallback `j.number‖j.id` | Only in old-job search |

No pagination bugs, timezone or date-boundary shifts, or rate-limit truncation showed up in the synced scope. Dates are plain `YYYY-MM-DD` on both sides, and the month totals line up exactly for live-job time.

## Recommended fixes (ranked)

1. **Scope views 9, 10 and 11 to every job status.** Use the same filter view 7 already uses: `job_status in ["In Play","Complete","Paused","Archived"]`. Invoices would grow from 46 to 2,457 records (5 pages), quotes from 76 to 1,434 (3 pages) and expenses from 234 to 4,883 (10 pages). That is about 18 calls an hour, and the slim-file approach in `jobs_slim.py` keeps the payload small. If expenses or quotes look too heavy, at least do invoices, since they drive receivables and revenue. Add a date floor if needed (for example `invoice_date >= 2025-07-01`; the filter syntax needs testing).
2. **Add a "recently archived" pass for logged time.** The full view is 119k entries, so don't sweep all of it. Each hour, query view 8 with `date >= "<today−120d>" and job_status in [...all four...]`. That is about 25k rows, 50 pages, too many per hour, so run it as a slow second sweep: same cursor logic, its own state file, a few pages per cycle, completing roughly daily. That recovers the 464 entries and closes the gap permanently. For a one-off backfill of history, run a single all-status pass per month, about 240 pages spread over several nights.
3. **Prune deleted entries at the end of each completed pass.** For records inside the swept scope, drop ids that were not seen in a full pass. Track the ids seen per pass in the sweep state. Do not prune entries on archived jobs until fix 2 is in place, or the platform would lose history it can't re-read.
4. **Label scope in the UI until fixes 1 and 2 ship.** Reporting revenue, the Invoices list and the Overdue card currently look authoritative. Add a "live jobs only" note, or use the job-level totals from `jobs.json`, which are complete, for revenue.
5. **Fix the job number for jobs without one.** Fall back to the leading digits of the name (`/^(\d{3,5})\b/`) before the internal ID.
6. **Keep this check recurring.** `reconcile_streamtime.py` costs about 140 calls; most of that is the 4-month logged-time pull. A cheap monthly guard needs about 30 calls: statistics-only (`limit=1`) per month and per view, compared with platform totals, alerting above 1%.

## Method and API usage

- **Endpoints:** the same as the sync. `GET /users`, `POST /search?search_view=7|8|9|10|11|12|13|17|18` (search views only accept POST, and `GET /search` returns 405; these are read-only queries), and `GET /jobs/{id}/job_items` on the tenant host for the 30 sampled jobs.
- **Statistics:** each search response carries a `statistics` block (matchedRecords, totalMinutes, billable and non-billable minutes, invoice totals). This allowed exact counts and totals from 1-record queries.
- **Logged-time filter:** `date >= "X" and date < "Y"` is honoured, and the sync's recent-window probe already relies on it.
- **API usage:** 138 calls reached the API, with no 429s. Calls were paced 1.6 s apart, with Retry-After and exponential backoff, under a hard cap of 220. Another 8 attempts failed locally at TLS setup before any request was sent, because python.org Python on macOS lacks a CA bundle and the script now uses `/etc/ssl/cert.pem`.
- **Raw responses:** cached outside the repo.
- **API key:** read from `~/.streamtime_key` at runtime and sent only in the Authorization header. It was never printed or written to any file; I scanned every file written during the check to confirm this.

## Fixes applied (13 Nov 2026, not yet pushed)

| Fix | Where | Status |
|---|---|---|
| 1. Views 9, 10 and 11 fetched for every job status, slimmed (`record_slim.py`) | `scripts/streamtime_sync.py` | Live-tested: 2,457 invoices; 75 awaiting payment, $477,704.70 outstanding (matches Streamtime). invoices.json is 1.5 MB (145 KB gzipped) |
| 2. Second logged-time pass over every job status, last 13 months (from 1 Oct 2025, 44,782 entries), 15 pages an hour, so a full pass takes about 7 h | `logged_times_sweep.sweep_archive()`, state in `logged_times_sweep_all.json` | Live-tested one page. logged_times.json will grow from about 20k to about 45k entries (about 8.7 MB to about 18 MB uncompressed) |
| 3. Deleted entries pruned: an in-scope entry missed by two complete passes in a row is dropped; passes with skipped pages never prune; capped at 2% of the pass | `logged_times_sweep._prune()` (main pass scope = live jobs, archive pass scope = window) | Unit-tested with a fake API, including the cap |
| 5. Job number taken from the start of the name when Streamtime has none, unless another job already uses it | `index.html` `_stJobNum()` | 2,748 jobs, no duplicate ids |

Fix 4 (UI "live jobs only" labels) is no longer needed once 1 and 2 are live. Fix 6 (monthly check): re-run `scripts/reconcile_streamtime.py`.
