# C&C Platform: hands-on review, November 2026

13 Nov 2026 · v2.43.0 (main at eda212e) · branch `worktree-agent-ae9b12db5550e563a`

## How this was done

- **Hands-on use.** I served the worktree locally and used it in light and dark mode at 1440 px, as a producer, a designer, the MD and an admin would on a normal day. I covered:
  - Dashboard and To Do (Week, Today and Calendar views; adding and editing tasks, log as done, split, drag).
  - Jobs and job detail.
  - Time, Expenses and POs, Quotes, Invoices, Clients and Deadlines.
  - Schedule, Boards and Settings.
  - ⌘K and the keyboard shortcuts.
- **Code read.** Three reviewers read the code in parallel, one per area: Dashboard, To Do and Time; Jobs and billing; and Schedule, Settings, search and theme. I checked every finding below against the final, wrapped definition of each function.
- **Out of scope.** Reporting is being overhauled on another branch, so it isn't covered here.

Severity: **H** = wrong data or a blocked task · **M** = friction or confusion in a daily flow · **L** = polish.
Status: **Fixed** = done on this branch · **Open** = recommended next.

---

## Top 20, ranked

| # | Screen | Problem | Sev | Status |
|---|---|---|---|---|
| 1 | Settings → Team | Teams can only be changed one person at a time, by typing free text. There's no way to rename Design to Creative or merge two teams. A typo creates a new team, and nothing lists the teams or shows who is in each. | H | **Fixed**: Manage teams |
| 2 | To Do | Board edits (new tasks, moves, resizes, splits, ticks) are held in memory only. A reload re-seeds the board from Streamtime and the edits are lost, with no warning. | H | Open (see "Left for next time") |
| 3 | Settings → Workspace sync | **Published config drifts.** Labels and item types from a published config were applied in memory only. One reload later they reverted, and the config was never applied again. | H | **Fixed** |
| 4 | Settings → Workspace sync | **Publishing overwrote personal settings.** It copied the publisher's dashboard preferences (team filter, hidden blocks) over everyone else's. | H | **Fixed** |
| 5 | Settings → Data | The workspace backup missed leave, rate cards, templates, team targets and the invoice, PO and credit-note counters. Restoring it could reissue numbers that were already used. | H | **Fixed**: backs up every `cc_*` key except secrets and per-device state |
| 6 | To Do | Splitting a task targeted the wrong days for part-timers: a Tue–Fri person's split landed on Mon/Tue, and half the task vanished. | H | **Fixed** |
| 7 | To Do | **Follow-up time was mislogged.** Time logged from the "Done! add more time?" prompt was always billable, even on non-billable jobs, because it read the wrong field. It was also dated today rather than the task's day. | H | **Fixed** |
| 8 | To Do / Log time | Hours input misread common formats: "45min" became 45h, "90 minutes" 90h and "1:30" 1h. | H | **Fixed** |
| 9 | Time | No time entry could be deleted. A task that was reopened and ticked done again logged its time twice. | H | **Fixed**: platform-logged entries can be deleted, and re-ticking doesn't log again |
| 10 | Jobs | "Select all" then Archive or Label only touched the first 60 jobs, the ones rendered so far. | H | **Fixed**: "Select all N matching" |
| 11 | Quotes | **Quote detail was unreachable.** Clicking a quote opened only the print preview, so the detail panel (status, edit lines, create invoice) could only be found through search. | H | **Fixed**: the row expands, with Open quote, Preview document and Open job |
| 12 | Invoice document | Line amounts printed as "$1,234.5.00". | H | **Fixed** |
| 13 | Invoices | The issued and paid totals ignored search and filters, though the count beside them didn't. There was no "owing" figure. | M | **Fixed** |
| 14 | ⌘K | Opening it showed only "Type to search…": no recent jobs and no commands. You couldn't jump to a view or start an action from it, and hovering made the list jitter. | M | **Fixed** |
| 15 | Dashboard / To Do | "Add task" from the dashboard or the toolbar defaulted to **Friday**. From the dashboard it also landed in whichever week To Do was last left on, and the dashboard didn't refresh afterwards. | M | **Fixed** |
| 16 | Today view | Ticking a task done skipped the "log time?" prompt, the activity log and the job stats that the board runs. | M | **Fixed** |
| 17 | Keyboard | ←/→, J, Q, E, N and F fired behind open modals and panels. In 2- and 4-week Schedule ranges, ←/→ stepped one week. Escape didn't close the team-member panel. | M | **Fixed** |
| 18 | Many | User text was put unescaped into HTML. Affected: activity feed (item, milestone and expense names), dashboard "Your day", jobs labels and PO, Settings names, team datalists. A client name with an apostrophe broke drag. A new person with an apostrophe got a key that broke every button for them. | M | **Fixed** |
| 19 | Settings | Anyone could publish the shared config, delete labels or item types without confirmation, and edit other people's cost rates. | M | **Fixed**: admin guard (soft, like archive) plus confirmations |
| 20 | Dashboard (MD) | There was no way to see who is behind on timesheets without opening each person's week. | M | **Fixed**: new Timesheets card |

---

## All findings by screen

### Dashboard
- **H. Fixed.** Add task defaulted to Friday and the wrong week, and the dashboard didn't refresh after adding.
- **L. Fixed.** The red "over target" bar on Billable could never show, because the percentage was clamped to 100 before the check.
- **M. Fixed.** "Your day" job and item text from Streamtime was unescaped.
- **M. Added.** A Timesheets card for admins: logged time against capacity, less leave, Monday to yesterday (last week on Mondays), listing people under 80%. Click a person to open their week. It ignores placeholder seats with no time in four weeks, and can be turned off in My profile.
- **L. Open.** The non-billable KPI bar uses a fixed 8h denominator.
- **L. Open.** The sparkline buckets weeks with a raw millisecond divide, so it can misplace a Monday around a daylight-saving change.

### To Do
- **H. Open.** Board edits aren't persisted (see "Left for next time").
- **H. Fixed.** Split days used the wrong days for part-timers.
- **H. Fixed.** Follow-up time had the wrong billable flag and the wrong date.
- **H. Fixed.** Time was logged twice when a task was reopened and re-ticked.
- **M. Fixed.** The Today view's done path skipped the follow-up prompt.
- **M. Fixed.** An empty task title did nothing silently; it now shows "Give the task a name". ⌘/Ctrl+Enter now saves the task modal and the New job modal.
- **M. Open.** Leave days still show full capacity in the Week view header. The capacity number feeds the card time-scale, so changing it needs care.
- **M. Open.** Billable is counted three different ways (`t.billable!==false` against `taskIsBillable`).
- **L. Fixed.** "Add New" now reads "Add task", and "· OVER" reads "over".
- **L. Open.** The task modal is `.tm-modal`, not the standard `.modal` structure. The calendar "+" is invisible until you hover over it.
- **L. Open.** On a weekend, Log time dates the entry to Friday without saying so.

### Jobs list and job detail
- **H. Fixed.** Bulk actions only reached the first 60 jobs.
- **M. Fixed.** Search now also matches PO, labels and contact.
- **L. Fixed.** Budget showed "$112.5"; it's now whole dollars.
- **L. Fixed.** The budget and hours bars used hex colours; they now use tokens.
- **L. Fixed.** Labels and PO were unescaped.
- **L. Fixed.** In the job team picker, rows were white in dark mode.
- **L. Fixed.** The due and overdue badges used hex colours; they now use the status tokens.
- **M. Open.** Two quote-status models don't sync. Approving a platform quote (`c2SetQuoteStatus`) doesn't move the job to Live, but approving a Streamtime quote does.
- **L. Open.** The status label "In Play" isn't sentence case. Saved filters key on that string, so changing it needs a small migration.

### Time
- **H. Fixed.** Platform-logged entries can now be deleted. Streamtime entries stay read-only.
- **M. Fixed.** Time logged on a platform-created job showed "—" for the job and dropped out of the job and client filters.
- **M. Fixed.** A single person's group started collapsed, so a filtered view looked empty.
- **M. Fixed.** The Jobs → Time button said "Add task" but opens Log time; it now says "Log time".
- **M. Open.** "Revenue ex GST" counts $0 for platform-logged entries, which have no `totalExTax`.

### Quotes
- **H. Fixed.** Quote detail was unreachable.
- **L. Fixed.** The empty state said "Quote data syncing" even when a filter was hiding platform quotes. It now uses the standard empty state, with New quote.
- **L. Open.** The Quote tab document has typed capitals in its headers and unescaped plan names.

### Invoices
- **H. Fixed.** The document printed amounts as "$1,234.5.00".
- **M. Fixed.** Totals ignored filters. There's now an "owing" figure.
- **L. Fixed.** The Uninvoiced header used hex colours.
- **H. Open.** Opening an invoice preview assigns the next invoice number and today's issue date. Abandoned previews leave gaps in the sequence.
- **M. Open.** Plan invoices round GST to whole dollars. Fixing it changes inc-GST totals by cents, which can turn invoices marked fully paid into part-paid, so it needs a decision.
- **M. Open.** Split invoices print without an invoice number and don't appear in the Invoices list.
- **M. Open.** The uninvoiced value leaves out expenses, but the Jobs footer includes them.
- **L. Open.** `showInvCtx` row menu is dead code and includes a destructive Delete. Wire up a safe version or remove it.

### Clients
- **M. Fixed.** Drag broke for names with an apostrophe.
- **M. Open.** The Invoiced and Paid totals on client cards leave out platform invoices.

### Deadlines
- **L. Fixed.** Invoice events showed only the company and couldn't be clicked. They now show number and amount and open the invoice.
- **L. Fixed.** The job colour was hex; it now uses a token.
- **L. Open.** A month with no events has no empty state.

### Schedule
- **M. Fixed.** In 2- and 4-week ranges, prev/next and ←/→ moved one week.
- **L. Fixed.** The 2- and 4-week People view had no empty state.
- **M. Open.** A single click on a card toggles done, skipping the To Do done path (time prompt, activity). It's also easy to do by accident.

### Settings
- **H. Fixed.** Manage teams (see below).
- **H. Fixed.** The config publish and apply bugs: labels and item types didn't persist, personal preferences were overwritten, and teams weren't published.
- **H. Fixed.** The backup was incomplete.
- **M. Fixed.** Added an admin guard on publish, label and item-type removal (with confirmation) and on editing other people's profiles.
- **M. Fixed.** The theme button label went stale after switching.
- **M. Fixed.** Names and teams were unescaped in member cards, the member panel and the datalists.
- **L. Fixed.** Sentence case: My profile, Workspace defaults, Job items, Workspace sync.
- **L. Fixed.** "✓" glyphs replaced with Tabler checks.
- **M. Open.** Workspace defaults are described as company-wide, but they're per-browser and not published.
- **L. Open.** The add-member inline form uses `filter-btn` inputs, and the number inputs are styled inline rather than with `form-inp`.
- **L. Open.** `deletePerson`, `startTimer` and `discardTimer` still use the native `confirm()`.

### Search, keyboard and theme
- **M. Fixed.** ⌘K is useful before you type: recent jobs, starred items and quick actions.
- **M. Fixed.** While you type, ⌘K matches actions and views ("new quote", "schedule", "dark", "manage teams") and people (opens their week).
- **L. Fixed.** Hover no longer re-renders and jitters the list.
- **M. Fixed.** Shortcuts are guarded behind modals and panels, and Escape closes the member panel.
- **L. Fixed.** The star colour is now a token, with a dark-mode value.
- **L. Open.** The sidebar items are `div`s with no tabindex or role, so they can't be reached by keyboard.
- **L. Open.** The shortcuts list omits a few shortcuts (Boards N and /, Schedule ←/→).

---

## Settings → Team → Manage teams (built)

Admin-only through `_needAdmin('manage teams')`. Open it from the new Teams card at the top of Settings → Team, or from ⌘K with "manage teams".

- **Teams card.** Lists every team with its member count and avatars, plus a "No team" bucket.
- **Rename.** Renaming a team updates it everywhere:
  - every person's `team`, archived people included;
  - everyone's dashboard team filter (`dashTeams`);
  - the team targets (`cc_team_targets`).

  Renaming to a name that already exists offers to merge instead.
- **Merge into.** Moves everyone into another team, carries the target over if the destination has none, and removes the old team.
- **Add team.** Creates an empty team, stored in `cc_teams`.
- **Remove.** Removes a team, with confirmation if it has people; they're left with no team.
- **People grid.** Every active person has a team select, for moving people between teams (for example Harry Ross).
- **Saving and sharing.**
  - Changes save as you go through `savePeople()`.
  - Each change ends with a toast reminding you to publish the team config to share it.
  - The published config now includes `teams`, and applying a config writes them to `cc_teams`, so empty teams travel too.

---

## Missing but expected (agency tool)

These are ranked by daily value. "Razor" means it needs the shared backend.

1. **Durable To Do edits:** a local overlay now, a shared store with Razor.
2. **Timesheet approval or lock:** the Timesheets card is the first step. Razor.
3. **Company details in Settings:** legal name, GST number, address, logo, invoice footer and terms. These are hard-coded in the invoice document today.
4. **Public holidays calendar:** feeds capacity, To Do and the timesheet expectations.
5. **Unscheduled backlog on the Schedule:** drag from My items onto a person and a day.
6. **Invoice numbering at send time,** not when the preview opens.
7. **Recurring retainer invoices:** monthly, from a template.
8. **`.ics` export of a person's week and leave:** a stopgap for calendar sync.
9. **"Follow system" theme option,** and keyboard-reachable navigation.
10. **Email quotes and invoices:** Razor.

---

## Left for next time (ranked)

1. **Persist To Do edits.** Store a per-task overlay (moved day, hours, done, new native tasks) keyed by task id and week. Re-apply it on top of each fresh Streamtime seed instead of freezing whole weeks, so Streamtime changes still come through. The board's mechanics don't change.
2. **Invoice number and issue date when status first moves to Sent,** with "Draft" until then.
3. **Decide on GST rounding** for plan invoices (cents against whole dollars) and migrate existing payments.
4. **Platform quote approval moves the job to Live,** the same as Streamtime quotes.
5. **Split invoices get numbers** and appear in the Invoices list and totals.
6. **Leave days show zero capacity** in the Week header without changing the card time-scale. This needs a separate header capacity value.
7. **Schedule card click opens the task;** done goes through the To Do path.
8. **Count billable one way** (`taskIsBillable`) everywhere.
9. **Price platform-logged time** (minutes × the item or job rate) so Time revenue isn't $0.
10. **Publish workspace defaults and rate cards** with the team config.
11. **Client cards include platform invoices.**
12. **Remaining cleanup:** native `confirm()` calls, `filter-btn` inputs, sidebar accessibility, the shortcuts list, and the "In Play" label migration.
