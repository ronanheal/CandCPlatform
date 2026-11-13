# Design pass r5: one family with the task sheet

13 Nov 2026. Scope: Dashboard (not the hero's data logic), Jobs list and job detail, Quotes, Invoices, Time, Expenses and POs, Clients, Reporting, Settings, ⌘K, toasts, empty states, the sidebar, every other modal and drawer, and `login.html`.
Not in scope (other owners): To Do, Focus, Calendar/Schedule, the task sheet, who-am-I and switch user, and Boards.

Code: `<style id="ds-r5">` and `<script id="ds-r5-script">` at the end of `index.html`. A few markup and template edits sit in place; the list is in the last section.

## 1 · Reference: what the task sheet does

| Trait | How the sheet does it |
|---|---|
| Header | Muted 12.5px label ("Edit task") and a 30px round close button. No rule under it. |
| Hero | The title is a borderless display-type input (Inter Tight 650, 20–22px). |
| Properties | A 92px column of quiet icon labels, with controls that stay transparent until hovered. |
| Choice | A soft tinted well (ink 5%). The chosen option is a raised paper chip. |
| Footer | A warm `--surface-2` well with a hairline above it. Destructive action quiet at the far left, ghost Cancel, ink primary at the right. |
| Surface | White paper, hairline borders, 20px sheet radius, 8–10px control radius. |

## 2 · Audit (before), 1440, light and dark

How it was gathered: screenshots of every view and modal in scope, plus a computed-style crawl of each view (table-head colours, button heights, radii, ALL-CAPS and letter-spaced text).

**Page headers and toolbars**
- Title blocks started at 20px on some pages and 22px on others.
- Quotes and Invoices headers carried an extra 22px from the wrapper, so their titles sat lower than Jobs.
- Time put its filters in a different header bar from every other list.
- Toolbar gaps varied (6, 8 and 10px).

**Tables**
- Header rows came in three colours: `--surface-2` (most lists), `--off` (job plan tables, so cream on white) and nothing (Quotes, which is div-based).
- The Quotes header was misaligned with its rows by 34px from Company onwards, because the trailing spacer and chevron had different widths.
- In Invoices, the PO column took 234px while job names wrapped to three lines.

**Stat tiles**
- Five implementations: `.kpi`, `.time-stat`, `.ls-kpi`, `.rv-kpi` and `.stats-strip .stat-b`.
- Two type stacks: Reporting used Inter 600, the rest Inter Tight 750.
- Invoices coloured its numbers green and orange.

**Buttons**
- Mostly 34px, but the dashboard had 23px and 26px buttons.
- Job plan row actions were 19px.
- Modal Cancel was an outline button in some modals (`.d-action`) and ghost-like in others.

**Pills and chips**
- Mostly unified by ds-v3.
- The client detail "Billable" chip and the contact cards were hand-styled at 10–11px.

**Forms**
- Every modal stacked label over input, with 14px gaps plus field margins (about 28px rhythm).
- The new job's billing tiles had 2px black borders.
- The workflow stage control was a solid black segmented control, the loudest thing on the sheet.

**Modals**
- Headers had a bottom rule and an 18px title.
- Footers were white, with inconsistent padding (12/20, 14/24, 12/24).
- No convention for where Delete sits.
- The invoice editor had two solid red buttons ("Print / PDF", "Copy to Xero"), uppercase letter-spaced labels ("JOB NUMBER") and a two-line title.

**Red used as a non-danger signal**
- Chart hero series (billable, invoiced, paid), across Reporting, the dashboard sparkline and the utilisation heat-map ramp.
- Timeline Gantt "open" bars (`#ED1E24`).
- Deadlines "invoice due" chips (danger tint for invoices that are not late).
- ⌘K search icon.
- Attention-card palette: hard-coded `#D9622B`, `#C2185B`, `#C62828`, `#A07B45`, `#7E57C2` and `#8A857C` on icon wells and counts.
- Red checkbox accents in quote options and the job settings modal.
- Client job meters going red over 90%.

**Other hard-coded colour**
- Gantt `#7B9E87` and `#C4956A`.
- Client "Paid" figures in `--ok` green, and green "$x paid" text on client cards.

**ALL-CAPS and letter-spacing**
- Settings rail "SETTINGS".
- Client detail "JOBS" and "CONTACTS (2)".
- Invoice editor field labels and the payments header.
- Activity feed day headers.
- The "← Jobs" back pill was letter-spaced.

**Emoji in chrome**: none in chrome strings. Emoji appear only in user content (task titles) and in the mood check-in faces, which are content and were left as they are.

**Surfaces**
- The settings rail sat on its own tinted panel.
- The client info strip was a bare band of boxed inputs on the window cream.
- Contact cards were cream on cream.
- Gantt headers were cream inside a white box.
- The milestones card had a 6px radius inside a 16px world.

**Radii in use**: 3, 6, 8, 10, 16, 20 and 99. The 6px came from legacy inline styles: Gantt, milestones, contacts and client job rows.

## 3 · Primitives (after)

All of these are built from ds-v3 tokens. r5 adds only `--lbl` (the quiet label font), `--row-h`, `--tile-v`, `--hair`, `--seg-bg` and `--chart-1`.

| # | Primitive | Anatomy | Existing classes it skins |
|---|---|---|---|
| P1 | Page header | Display title, 30/750, −0.04em. One muted 13.5px line. 24px top, 28px gutter on every page. | `.view-title`, `.view-sub`, `.sett-tab-hd`, `.time-head-bar` |
| P2 | Toolbar | One row of 34px controls, 8px apart. A quiet tabular count at the right. | `.jobs-toolbar`, `.qinv-toolbar`, `.r-toolbar` |
| P3 | Card | White, hairline (`--hair`), 16px radius, `--e-1`. The card header is a crisp title, quiet meta and a faint rule. | `.rv-card`, `.sett-card`, `.att-card`, `.team-card`, `.client-card-full`, `.phase`, Gantt, milestones |
| P4 | Table | The header belongs to the card: white, 12.5/500 muted, sentence case, one hairline. 44px rows, `--surface-2` hover, tabular numbers. | `.jobs-table`, `.inv-table`, `.time-table`, `.exp-t`, `.qinv-head-row`, `.items-t`, `.prog-table`, `.rv-table`, `.fd-tbl`, `.c2-*` |
| P5 | Stat tile | Quiet label, then a 26px Inter Tight 700 tabular number **in ink**, then muted context, then a meter. Status lives in a dot or the context line, never in the number. | `.kpi`, `.time-stat`, `.ls-kpi`, `.rv-kpi`, `.stats-strip .stat-b` |
| P6 | Property grid | An icon and quiet label column (116px in sheets, 132px in form modals), then a control. In sheets the control stays transparent until hovered. | `.ds-props`, `.ds-prop`, `.ds-prop-l`, plus every `.ds-m .field` |
| P6b | Hero input | The record's name as a borderless display input, 22px/650. | `.ds-hero-inp` |
| P7 | Segmented control | A soft tinted well; the chosen option is a raised paper chip. | `.todo-view-toggle`, `.r-tabs`, `.wf-choice-row`, `.ds-sheet .bill-choice-row`, `.c2-seg`, `.fd-mode` |
| P8 | Status chip | 22px pill, 11.5/600, sentence case, tint and ink of one role. | `.inv-pill`, `.wf-badge`, `.exp-badg`, `.rv-pill` … |
| P9 | Modal shell | Header: a 17px display title and a 30px round close, no rule. Body: 8/24/20 padding. Footer: a `--surface-2` well with a hairline, quiet destructive at the far left, ghost Cancel, ink primary at the right. A destructive confirm uses `--danger-ink`, not brand red. | `.ds-m` (tagged by the script on every `.modal` outside excluded owners), `.ds-sheet` |
| P10 | Drawer | The sheet anatomy: a display title, a muted sub-line and a faint rule. | `.detail-drawer-*` |
| P11 | Empty state | A flat 56px icon well (no tilt, no glow), a 17px display line and one muted sentence. | `.empty-state`, `#time-empty` |

### Rules
- **Colour**
  - Red is the brand mark, the active-nav marker, today, the focus ring and danger.
  - Charts lead with dusk (`#5B6BAF` light, `#7383CC` dark). The palette was validated with the dataviz validator: lightness band, chroma floor, CVD (worst adjacent ΔE 9.7) and normal-vision floor all pass, in light and dark.
  - Heat-maps use one dusk ramp; amber still means over capacity.
- **Type**
  - Inter Tight for titles and numbers; Inter for UI text.
  - Labels are 12.5/500 muted, in sentence case.
  - Numbers are tabular everywhere.
- **Radii**
  - Sheets 20, cards 16, controls 10, rows and chips 8, pills 999.
  - The 6px radii found in the audit (Gantt, milestones, contacts, client job rows) are gone.
- **Footers**: Cancel and Close become ghost buttons automatically. Delete, Remove, Void and Discard move to the far left as quiet text unless they are the confirm.

## 4 · What changed, per screen

- **Dashboard**
  - Section titles now use the display face.
  - Needs attention: icon wells and counts are neutral; only the urgency pill keeps its role colour, and those colours are now tokens (warn, danger, info, muted).
  - Team today: task blocks are hairline rows, with a green dot and strike-through for done items instead of green fills.
  - Sparkline and charts are dusk.
- **Jobs list**
  - Header and toolbar follow P1 and P2; the table follows P4 (white head, 44px rows).
  - The New job sheet is now a task-sheet twin:
    - a muted "New job" header and the job name as the hero;
    - icon property rows for Company, Contact, Job number, PO, Billing (segmented) and Stage (segmented);
    - the stage hint sits under the grid;
    - the template picker, when templates exist, becomes one more property row.
- **Job detail**
  - Header:
    - the quiet back pill;
    - a muted meta line (number, company, billing; the boxed number chip is gone);
    - the name at 32/750;
    - the brief field is invisible until hovered or focused.
  - Tabs sit on a full-width hairline.
  - Phase cards are white with white table heads.
  - Timeline:
    - the Gantt is a card;
    - open bars use the chart hero, complete bars are faded green and paused bars are subtle;
    - the today line stays red;
    - the milestones card is restyled.
  - Fixed: the Create → Quote menu item lit the Progress tab while showing Quote.
  - Opening a job from anywhere now marks Jobs in the sidebar.
- **Quotes**
  - Header alignment is fixed: the chevron column matches the header spacer.
  - P4 head. The New quote sheet follows the New job pattern; the line-item editor injected by c2 still mounts below it.
- **Invoices**
  - KPI numbers are in ink, with a warn dot on "awaiting payment".
  - The PO column is capped and the Job column widened, so names fit on one line at 1440 and 1920.
  - Invoice editor:
    - the title is a quiet single line;
    - Print / PDF is the ink primary and Copy to Xero is secondary (both were red);
    - labels are in sentence case.
- **Time, Expenses and POs**: P1, P2, P4 and P5. The expense and PO forms use the property-grid shell.
- **Deadlines**: invoice-due chips and the legend now use info blue; red is no longer used for "due".
- **Clients**
  - Cards: display-face name, ink numbers, paid figures in `--ok-ink`.
  - Detail:
    - the info strip is a property card with quiet inline fields;
    - Revenue, Invoiced and Paid totals are display numbers, all in ink;
    - contacts are paper cards;
    - "Contacts" and "Jobs" are sentence-case section heads with counts;
    - job rows are paper rows with calm meters (danger tint only over 90%).
- **Reporting, all tabs**
  - P5 tiles: Reporting's numbers move from Inter 600 to the shared display style.
  - P4 tables; dusk charts; the heat-map ramp is dusk.
- **Settings**
  - The rail is transparent with a faint divider; the "Settings" eyebrow is sentence case.
  - Nav icons are subtle and turn ink when active.
  - Card headers get a faint rule; Team → Access inherits the card and modal shells.
- **Modals and drawers**
  - Every `.modal` outside the excluded owners gets the P9 shell. Every `.field` becomes a label-left row. One change reaches every form built on `.field`; checked by hand: new client, add expense, add leave, job settings, CSV import and confirm.
  - Confirm dialogs: the message is 14.5/500, and a destructive confirm is `--danger-ink`.
  - What's new uses neutral bullets.
- **⌘K**: the search icon is muted and the selection marker is ink.
- **Login**: paper card on `--white`, quiet 12.5 labels, 40px controls, the app's focus ring, an ink primary with a neutral hover (no red tint), and a neutral link underline on hover.

## 5 · Deliberately left alone

- The task sheet, To Do, Focus, Schedule and Calendar, Boards, who-am-I and switch user.
  - `.ds-m` excludes `#whoami-modal`, `#realloc-modal`, `#rollover-modal`, `#todo-modal` and `bv-*`.
- The printed invoice and quote paper (red logo, uppercase document table heads): that is the document, not chrome.
- Mood check-in faces (content).
- The dashboard hero's data logic.
- Version and release notes, to avoid three-way conflicts with the parallel agents. Add a release-notes entry when merging.

**Side effect:** the chart palette change is global, because CV is shared. Any chart on another owner's screen that uses `CV.slot(0)` also turns dusk; that is intended, since red is now reserved.

## 6 · In-place edits (not in the r5 blocks)

All are presentation only; IDs and handlers are unchanged.

- `#create-modal` and `#new-quote-modal` markup, restructured as sheets.
  - All IDs are kept. Contact and PO gained `nj-contact` and `nj-po`; they were previously unnamed and unread.
- Smaller markup edits:
  - Settings rail eyebrow.
  - The static client-detail "Jobs" label (now rendered with a count).
  - The Create menu's Quote item: tab index 1 changed to 2 (bug fix).
- Template colour edits:
  - Attention card colours: hex values replaced with tokens.
  - Gantt bar, legend, header and frame colours.
  - Deadlines invoice chip and legend.
  - Milestones card.
  - Client detail contacts and job rows.
- `_ccEnsureTplField`: renders as a `.ds-prop` row when it finds the sheet's `.ds-props`; otherwise it keeps the old path.
