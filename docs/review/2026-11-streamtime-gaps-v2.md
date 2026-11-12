# Streamtime gaps, second pass (v2)

13 Nov 2026 · based on v2.42.2. This follows on from section C of `2026-11-polish-and-gaps.md` and the June audit.

**Sources:** Streamtime's help centre index (`help.streamtime.net/llms.txt`) and these articles: Integrations, Xero, Google Calendar, Zapier, MCP, WIP report, soft bookings (paused To Dos) and importing contacts. Also `scripts/streamtime_sync.py`, `scripts/jobs_slim.py`, the live `streamtime-data` branch (record counts from 11 Nov) and `index.html`.

**Key:**
- **Have / Partial / Missing** describes C&C today.
- **Now** means the front end can build it. **Razor** means it needs a backend, logins, write-back, OAuth or server-side secrets.
- *(unverified)* marks claims checked against an article title or a description only.
- **Built here** means this branch builds it (see the end of this document).

Since the first audit, these have shipped: log time and a timer in the task form, leave, My items, job templates, Time grouping and CSV, quote line items and discount, invoice from quote or time with part payments, schedule by job across several weeks, rate cards, the Teams report, Boards v2 and platform invoices in the Invoices list. Supplier purchase orders and credit notes are being built by another agent and are counted as *in progress*.

---

## 1. Gap table by area

| Area | Streamtime capability | C&C | Bucket | Notes |
|---|---|---|---|---|
| **Jobs & planning** | Jobs list: filters, group by, columns, totals | Have | — | |
| | Job templates | Have | — | v2.42.0 |
| | Labels on jobs | Have | — | |
| | **Items list view** (every item across jobs) | Missing → **Built here** | Now | Streamtime lists items as their own list with planned/used. |
| | Plan hours by **role** (unassigned role demand) | Missing | Now (partial) | `roles.json` is synced but never loaded. Role demand on the Schedule needs item→role data, which the sync doesn't pull (see section 3). |
| | Timeline zoom (day/week/month/year) | Partial | Now | Timeline exists. Zoom levels *(unverified in C&C)*. |
| | Job activity and comments with @mentions | Partial (per browser) | Razor | Shared comments and notifications need a shared store. |
| | Pulse/AI job health card | Partial (health/pulse, rules-based) | Now / Razor for LLM | |
| **Scheduling & To Do** | Weekly To Do, repeats, My items, leave | Have | — | |
| | Schedule by people and by job, multi-week | Have | — | v2.42.0 |
| | **Soft bookings** (paused To Dos, dashed, hidden from the person's list, still reserving capacity) | Missing → **Built here (To Do board)** | Now | Added by wrapping only: a right-click option and a dashed card. See section 5. |
| | Availability modal (capacity by role) | Partial | Now | Capacity by person exists; by role needs role data. |
| | Plan my week auto-scheduler | Removed on purpose (v2.2x) | — | |
| **Time** | Log time, timer, Time list grouping and CSV | Have | — | v2.41 / v2.42 |
| | Time approval | Missing | Razor | No Streamtime article found. Probably not a Streamtime feature either *(unverified)*. |
| | Write-back of time to Streamtime | Missing | Razor | Native time stays in `cc_native_time` until Streamtime has the same entry. |
| **Quotes** | Line items, discount, versions, print | Have | — | v2.42.0 |
| | Email templates and sending | Partial (print/PDF only) | Razor | Needs an SMTP or transactional email key held server-side. |
| | Client online approval | Missing | Razor | Not confirmed as a Streamtime feature *(unverified)*. |
| **Invoicing** | Invoice from quote or time, part payments, platform invoices in the list | Have | — | |
| | Credit notes | In progress (other agent) | Now (local) / Razor (Xero) | |
| | Payment status from Xero | Partial (hourly via the Streamtime sync) | Razor | |
| **Expenses & POs** | Expenses with markup | Have | — | |
| | Supplier purchase orders | In progress (other agent) | Now / Razor (Xero) | |
| **Clients** | Companies and contacts | Have | — | |
| | **Contact import (CSV with mapping)** | Missing → **Built here** | Now | Streamtime maps CSV columns and rejects duplicate company names. Ours does the same and also dedupes by email. |
| | Company rate card, branch, labels, archived status | Partial | Now | `companies.json` has `rateCardId`, `branchName`, `companyStatus` and `companyLabels`. The front end ignores all four. |
| **Reporting** | Business, Teams, People, Jobs, Clients, profitability | Have | — | |
| | **WIP report** (logged sell, scheduled sell, approved expenses, unscheduled, future draft expenses) | Partial (uninvoiced table only) → **Built here** | Now | The new tab shows WIP against invoiced and the projected margin at completion. |
| | Job cost report | Partial (profit section per job) | Now | |
| | Custom report builder | Missing | Now (L) | Large. The Items list plus CSV covers the most common ask. |
| | Billing report (by month) | Partial | Now | |
| **Team & settings** | Team, hours, rates, roles text | Have | — | |
| | Access levels and permissions | Partial (soft admin) | Razor | |
| | 2FA (Streamtime needs it for Xero) | Missing | Razor | |
| **Other** | Global search, starred, boards, create shortcuts | Have | — | |
| | Notifications and @mentions | Missing | Razor | |
| | Multi-currency (USD rate card exists in Streamtime) | Partial | Now | Quotes and invoices carry `currencyCode` and `exchangeRate`. The UI assumes NZD. |
| | Multiple branches (2 legal entities: C&C Global Ltd, Content & Co NZ Ltd) | Missing | Now | `branches.json` is synced but never loaded. Invoices and quotes should show the right entity, tax number and address. |

---

## 2. Connections and integrations

What Streamtime offers, what C&C has, and exactly what each one would need.

| Integration | Streamtime does | C&C today | What it needs |
|---|---|---|---|
| **Xero** | Sends invoices, credit notes, bills (expenses) and POs to Xero. Payment status and paid date come back by **Xero webhooks**. POs need a manual refresh. Account codes, tax rates and tracking categories are set per line. Needs 2FA in Streamtime. Several Xero orgs are supported. | Clipboard/CSV export. Paid status arrives indirectly through the hourly Streamtime sync (84 of 85 invoices are Xero-linked: `externalAccountingPlatformName`). | **Razor:** a Xero OAuth 2.0 app (client id and secret held server-side, never in `index.html`), with a token store and refresh per tenant. Scopes: `accounting.transactions` and `accounting.contacts`. A **webhook endpoint** with HMAC signature check (`x-xero-signature`) for invoice and payment events. Server-side mapping of account codes and tax rates. Two orgs means two tenant connections. |
| **QuickBooks / MYOB** | Same send-to pattern. | — | Not used by C&C. Skip. (QuickBooks: Intuit OAuth app and webhooks. MYOB: AccountRight API key and OAuth.) |
| **Google Calendar** | One-way, Google to Streamtime. Each person connects their own calendar. Events become Personal To Dos, or job To Dos when the title contains `[J-0042]`. Always, never or manual create per event type. Syncs three months ahead, continuously. | Listed as "soon". Leave is manual (`cc_leave`). | **Razor:** a Google Cloud OAuth client (consent screen, scope `calendar.readonly`). A **refresh token per person** stored server-side. A background poller or **push channel** (`events.watch` with an HTTPS webhook, renewed about weekly). **Now (partial):** a one-off `.ics` export of someone's To Dos or leave works from the front end, with no OAuth. |
| **Slack** | Through Zapier: job activity or comments to a channel, @mentions to a DM. | Listed as "soon". | **Razor:** a Slack app with an incoming webhook URL (a secret, so it lives server-side) for channel posts, or a bot token (`chat:write`) for DMs. Events come from the backend: overdue invoice, uninvoiced nudge, milestone due. |
| **Zapier** | Triggers: job activity, comment added, label added, contact updated, new expense. Actions: create a job from a template, add an expense, create a To Do, create a board card. | — | **Razor:** a public API first (below), then a Zapier app (Zapier CLI, API-key or OAuth auth, REST hooks for triggers). |
| **Public API** | v1 (Swagger, API key per org) and v2 *[BETA]*. | Read-only, through the GitHub Action using the Streamtime key as a repo secret. | **Razor:** a REST API on the Razor backend with per-user API keys or OAuth, plus rate limiting. |
| **MCP / AI assistant** | `https://mcp.streamtime.net`: OAuth 2.0 with Dynamic Client Registration, acts as the signed-in user, read and write. Works with Claude, ChatGPT, Gemini Enterprise, Copilot Studio and Cursor. An "AI Agent" is in *[ALPHA]*. | — | **Razor:** an MCP server (Streamable HTTP) in front of the Razor API. It needs OAuth 2.1 and DCR, which means real logins. Read-only tools first: search jobs, job summary, my week, uninvoiced. **Now:** you can already point Claude at Streamtime's own MCP while Streamtime is live. |
| **Email sending** (quotes, invoices, email templates) | Built in, with templates. | Print or PDF only. | **Razor:** a transactional email provider (Postmark, Resend or SES) with an API key held server-side, sender domain DNS (SPF, DKIM) and bounce webhooks. **Now (stopgap):** a `mailto:` link with a templated subject and body. The PDF still has to be attached by hand. |
| **Contact import** | CSV with column mapping. Companies first, then contacts. Duplicate company names rejected. | **Built here** (front end, into `cc_clients`). | None. |
| **Importers** (Harvest, WorkflowMax and others) | No dedicated article found *(unverified)*. | — | Not needed. Streamtime itself is the source. |
| **SSO** | No article found *(unverified)*. | Soft login (v2.39). | **Razor:** Google Workspace OIDC (one OAuth client). Real permissions follow from it. |
| **Wayahead** (forecasting) | Listed in the June audit, not connected. | — | Skip. |

---

## 3. Data the sync could pull but doesn't (or pulls and the front end ignores)

**Pulled but ignored by the front end:**

| File | What's in it | Use |
|---|---|---|
| `roles.json` | 21 roles | Plan by role, capacity by role. Never fetched. |
| `rate_cards.json` | Standard (NZD), USD Rate Card | Could seed C&C's local rate cards. Never fetched. |
| `branches.json` | 2 entities, with tax numbers and addresses | Correct entity on quotes and invoices. Never fetched. |
| `organisation.json` | Empty (0 records) | The endpoint probably needs another path or scope *(unverified)*. |
| `companies.json` | `rateCardId`, `branchName`, `companyStatus`, `companyLabels`, `postalAddress` | Rate card per client, archived clients, client labels. Only name, contact and address are read. |
| `contacts.json` | `contactStatus`, `contactLabels`, `position` | Archived contacts are only used to rank the primary contact. |
| `invoices.json` | `externalInvoiceId`, `invoiceLabels`, `sentTo`, `reference` | A "View in Xero" deep link, labels, who it was sent to. |
| `quotes.json` | `approvedBy`, `approvedDate`, `sentTo`, `discount`, `exchangeRate` | Approval audit, currency. |
| `job_assignments.json` | `totalIncompleteMinutes`, per-person `totalLoggedTimeExTax` | Remaining scheduled hours per item and person, which is the "Scheduled time sell" in Streamtime's WIP. Used by the new Items list and WIP report. |

**Not pulled at all (would need `streamtime_sync.py` changes, so Razor or sync work):**
- Item → role assignment (`job_item_roles`): plan by role.
- Quote and invoice **line items** (detail endpoints): read-only line view for Streamtime docs.
- **Purchase orders** and **credit notes**: invoiceType is always "Invoice" in the 85 synced. Credit notes are a different type or view.
- **Paused To Dos** (`logged_time_status` for paused): only status 1 (scheduled) and 2 (logged) are pulled, so Streamtime soft bookings don't come across.
- Draft (unapproved) expenses: view 9 is used. Its status split is not checked *(unverified)*.
- Job activity and comments, Priorities boards, labels master list, user non-working days and holidays.
- Sync health: `sync_meta.json` shows **quotes view 10 rate-limited** on the last run ("gave up at offset 0"). Quotes can lag by a cycle.

---

## 4. Build next, ranked

| # | Build | Bucket | Why |
|---|---|---|---|
| 1 | **Items list** (all live items with planned/used, assignees, CSV) | Now: **built here** | Producers' main cross-job view in Streamtime. Nothing like it in C&C. |
| 2 | **WIP and projected margin report** | Now: **built here** | Matches Streamtime's WIP report and adds invoiced against WIP and margin at completion. Finance asks for it monthly. |
| 3 | **Contact import (CSV)** | Now: **built here** | Cheap onboarding for new clients and Xero or CRM exports. |
| 4 | **Soft bookings** (tentative To Dos) | Now: **built here** (board only) | Lets producers pencil in pitches without committing people. |
| 5 | Load `branches.json` and `roles.json`; entity on docs; capacity by role | Now | The data is already synced. Small. |
| 6 | Client rate card and archived flag from `companies.json` | Now | Wires Streamtime's per-client rate card into the v2.42 rate cards. |
| 7 | `.ics` export of a person's week and leave | Now | A stopgap for the calendar connection. |
| 8 | Xero OAuth with webhooks (invoices, credit notes, POs) | Razor | The blocker for switching off Streamtime. |
| 9 | Transactional email for quotes and invoices | Razor | |
| 10 | Shared store, logins, notifications, @mentions | Razor | The foundation for 8, 9 and 11. |
| 11 | Google Calendar sync (per-user OAuth with push channels) | Razor | |
| 12 | Public API, then Zapier, then an MCP server | Razor | In that order. MCP and Zapier both sit on the API. |
| 13 | Sync: pull paused To Dos, item roles, doc line items, POs and credit notes | Sync / Razor | Closes the data gaps in section 3. |

---

## 5. Built in this branch (feat-e)

All of it sits in `<script id="feat-e-script">` and `<style id="feat-e-styles">` before `</body>`, using wrappers only.

- **Jobs → Items:** a new tab listing every item on live (in-play) jobs. Columns: job, phase, item, assignees, planned and logged hours, planned and used sell, % used, status and due. Search, filter (status, client, person, over plan, overdue) and sort on any column. The totals row matches the sum of the jobs' item plans. CSV export.
- **Reporting → WIP:** one row per live billable job. Columns:
  - WIP: logged sell plus approved expense sell.
  - Invoiced: Streamtime-issued plus platform invoices that are sent or paid, plus sent or paid split invoices.
  - Uninvoiced WIP.
  - Remaining planned sell: plan minus used, floored at 0.
  - Projected revenue: the greater of plan and used, plus expenses.
  - Cost to date: from `computeJobProfit`, which is staff cost at cost rates plus expense cost.
  - Projected cost: cost to date plus remaining hours at the job's blended cost rate.
  - Projected margin and margin %.

  It also has totals and CSV, and the Export button exports this tab. Rows flagged "est." use the default cost rate.
- **Clients → Import CSV:** upload or paste a CSV and map its columns: company, contact, first and last name, email, phone, position, website, address and notes. The preview marks each row new, merge (contact added to an existing company) or duplicate (company plus email already known, skipped). Import writes to `clientsData` through `saveClientsData()`.
- **Soft bookings:** right-click a To Do card and choose "Mark as tentative". The card gets a dashed outline and a "Tentative" tag, and stays in capacity, as in Streamtime. It's stored per browser in `cc_soft_bookings` keyed by task id. Streamtime's own paused To Dos aren't synced, so they can't show yet (see section 3).
