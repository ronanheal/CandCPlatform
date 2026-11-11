# C&C Platform — polish and build review

12 Nov 2026 · v2.39.1 live. This is a list for you to review. Tick or strike items, add notes, then I'll build what you pick.

> **Status (12 Nov, v2.40.0):** A1–A6 and B1–B9, B11 and B12 are built. Still open: merging duplicate clients (rest of A4), B10 phone layout, B13 inline-style cleanup, and the rest of B11 (a few hundred less-common hex colours). Section C hasn't been started.

- **Effort:** S = under half a day, M = 1–2 days, L = bigger.
- **Bucket:** *Now* = we can build it in the current front end. *Razor* = it needs the shared backend, logins or Streamtime/Xero write-back, so it becomes part of their spec.

How this was made: I clicked through every main view of the live site in light and dark mode at desktop size, and measured the code. The Streamtime comparison uses the June screen-by-screen audit plus Streamtime's help centre, and each C&C status was checked against the code.

---

## A. Things that look wrong (fix first)

| # | What you see | Why | Effort |
|---|---|---|---|
| A1 | Job Plan: an item shows hours "— / 5h" but sell "$413 / $750" (e.g. job 7160, BAU scheduling) | The hours column comes from the logged-time file, which is still backfilling. Sell comes from Streamtime's own item totals. Use one source for both. | S |
| A2 | Dashboard "Billable this week 4h 45m" is the *planned* number; done is 0h | The headline should be done, with planned in the subtitle (or relabel it) | S |
| A3 | Reporting subtitle always says "Business overview · This Month" | It doesn't follow the period picker | S |
| A4 | Quiet clients lists Content&co (us) and near-duplicate companies (Delmaine / Delmaine Fine Foods, BearWell Ltd / BearWell PTY Ltd) | Hide internal clients. Offer "merge" or "hide" for duplicates. | S |
| A5 | Client cards show "$1466k invoiced" | Should read $1.47M | S |
| A6 | Item status always "OPEN"; Streamtime's "In Play" never maps to in-progress | Product call: show In progress / Complete / Paused like Streamtime (audit item U4) | S |

## B. Design polish

**Consistency (biggest win for "feels finished")**

| # | Item | Effort |
|---|---|---|
| B1 | **One page-header pattern.** Left gutters differ between views (Clients is indented further than Jobs or Invoices). The red rule under the heading appears only on Dashboard and Boards. Primary actions sit in different places: New Job top right, New Quote mid-toolbar, two identical New Board buttons on an empty Boards page. Set one rule: title, subtitle, then the primary action top right, every time. | M |
| B2 | **Tables that don't wrap.** Invoice numbers ("INV-⏎5883"), due dates ("20 Nov⏎2026") and company names wrap onto two lines. Set column widths, nowrap and ellipsis with a tooltip. Jobs rows are tall because the company wraps. | S |
| B3 | **Quotes list matches Invoices.** It's a header-less card list today, and the job number appears twice (pill plus "[7288]" in the name). Make it the same sortable table with column headers. | M |
| B4 | **Job detail header.** The action buttons (settings, …, Invoice, Create) float right after the title instead of sitting in a right-aligned toolbar. The empty brief box takes a lot of space; collapse it until used. | S |
| B5 | **Status colours.** Approved and Open pills are still a cool indigo/blue; move them onto the warm status palette. Status column on the Jobs list says "LIVE JOB" on every row; only show non-default states, or use a dot. | S |

**Pages**

| # | Item | Effort |
|---|---|---|
| B6 | **Dashboard "Needs attention".** Names truncate to ~15 characters. Overdue invoices show only the company (add invoice # and amount). Quotes show the company, not the quote name. Quiet clients is a full-width card that's mostly empty; make it a compact card in the row. | S |
| B7 | **Schedule.** Person pills wrap to two rows and repeat first names (Bianca ×2, Freelance/Freelancer). Use first name plus initial, or a "people" dropdown with team groups. Add a small capacity bar per person-day. | S |
| B8 | **Charts.** Axis labels are tiny and almost invisible in dark mode. Non-billable is slate blue (cool). Legends are tiny. Give the charts one warm theme for both modes. | S |
| B9 | **Weekly happiness prompt** pops up over the Dashboard the moment you open the app. Make it an inline card on the Dashboard ("How's your week?") instead of a modal. | S |
| B10 | **Phone / small screens.** There are only 5 breakpoints, so the app is unusable on a phone. Start with read-only Dashboard, To Do (today) and job lookup on mobile. | M–L |

**Under the hood (keeps it polished as it grows, needed for the Razor handover)**

| # | Item | Effort |
|---|---|---|
| B11 | **Colour token sweep.** There are 545 hard-coded hex colours (#4CAF50 ×48, #FF9800 ×17, #ED1E24 ×19, #E65100 ×16) and ~70 cool `rgba(0,0,0,…)` shadows. Move them to the `--ok / --warn / --red` tokens and warm shadows. This also fixes most dark-mode oddities for good. | M |
| B12 | **Type scale.** One Settings page uses 9 different font sizes, including 9px. Snap everything to the 6-step scale in DESIGN_SYSTEM.md. | M |
| B13 | **Inline styles.** There are 1,517 `style=` attributes. Move the repeated ones (KPI tiles, pills, section labels) into classes. It's not visible, but it makes every future tweak one edit instead of twenty. | L (do gradually) |

## C. Streamtime: what's missing

**C&C already beats Streamtime on:** global search and ⌘K commands, the drag interactions (split days, drop dock, drag to invoice or board), Focus mode, the Monday rollover, the Dashboard nudges (quiet clients, deadline risk, uninvoiced), the quote→invoice funnel, DSO, client boards, dark mode and the happiness check-in.

### Recommended builds, ranked for daily use (all *Now*)

| # | Build | Why | Effort |
|---|---|---|---|
| C1 | **Add time entry + running timer** | Time can only be logged by ticking a task done or via ⌘K. Meetings and quick fixes get lost. This is the most frequent daily action. | S–M |
| C2 | **Leave / holiday blocks** on To Do and Schedule | Capacity and utilisation are wrong for anyone who's off. A manual version now; Google Calendar sync later (Razor). | M |
| C3 | **Schedule: jobs × people view + 2–4 week range** | Producers plan by job; today there's one people-only, single-week view. | M |
| C4 | **"My items" backlog** (assigned but unscheduled work) | People can't see what's waiting for them unless they open each job. | S |
| C5 | **Quote line items + discount** | Quotes are a single number. Real quoting needs editable lines from the job plan, a discount and a subtotal. | M |
| C6 | **Invoice from logged time / from quote, plus part payments** | Closes the billing loop natively; needed before Streamtime can be switched off. | M |
| C7 | **Job templates** ("save as template", pick one in New Job) | `duplicateJob` already does most of the work. Speeds up repeat retainers. | S |
| C8 | **Time list: group by job / client / item / week + CSV** | Weekly timesheet and billing checks. | S |
| C9 | **Supplier purchase orders** (bundle expenses into a PO document) | A common agency workflow. The Xero half waits for Razor. | M |
| C10 | **Rate cards** (per-client rate overrides) | Sell values are wrong for clients on non-standard pricing. The selector is already in Job Settings but isn't wired up. | M |

Smaller extras: keyboard shortcuts for create (T = task, J = job, Q = quote, I = invoice, E = expense) **S**; contact import **S**; job timeline zoom (week/month/quarter) **S–M**; per-job used-vs-planned chart **S**.

### Full gap list by area

| Area | Have | Partial | Missing |
|---|---|---|---|
| Jobs & planning | List with filters/columns/totals, create/edit, workflow, job plan, health/pulse | Templates, timeline (no zoom), activity (per-browser) | Rate cards, plan by role |
| Scheduling & To Do | Weekly To Do (beyond Streamtime), repeats | Team schedule (one view), capacity, My items | Plan-my-week auto-scheduler, soft bookings, leave |
| Time | Move time (native rows) | Logging (task-done/⌘K only), time list grouping | Timer, approval *(Razor)*, write-back *(Razor)* |
| Quotes | List, detail, doc options, versions | Line items (single value), emailing (print only), templates (one) | Discounts, client online approval *(Razor)* |
| Invoicing & Xero | List, overdue, DSO, uninvoiced | Create (job plan + splits only), payments (status only), void/edit, Xero (clipboard CSV) | Credit notes *(Razor)*, real Xero sync *(Razor)* |
| Expenses & POs | Expenses with markup, sub-lines | — | Supplier POs |
| Clients | Companies + contacts | — | Contact import |
| Reporting | Business/People/Jobs/Clients, profitability, CSV | WIP (uninvoiced only) | Custom report builder (L), projected margin, items list |
| Team & settings | Team, hours, rates, soft admin | Permissions (no login) | Roles with rates, 2FA *(Razor)* |
| Other | Search, starred, boards | Keyboard shortcuts | Notifications/@mentions, Google Calendar, Zapier/API *(Razor)* |

### For the Razor spec (backend needed)

Logins and real permissions · one shared store for To Do, boards and activity (today these live in each person's browser) · two-way Xero sync (invoices, credit notes, POs) · sending quotes and invoices by email · notifications and @mentions · Google Calendar leave sync · writing time and job edits back to Streamtime until it's switched off.

### Not confirmed

Whether Streamtime offers client online quote approval, soft bookings, time approval, and how its holiday tracking and phone experience work. Only help-article titles were seen for these.
