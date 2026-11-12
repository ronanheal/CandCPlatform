# C&C Platform: design audit and design system v3, November 2026

This is the design and motion audit behind the `ds-v3` layer in `index.html`. It covers what was inconsistent or broken on every screen, in light and dark, and the system that now replaces the older layers. Charts are out of scope: a separate pass is rebuilding them. The screen-by-screen redesign comes next and builds on this system.

## How this was done

- I served the worktree and went through every screen at 1440×900 in light and dark: Dashboard, To Do (week, calendar, Today and the task modal), Jobs list and job detail tabs, Items, Time, Expenses and POs, Quotes, Invoices, Clients, Deadlines, Schedule, Reporting tabs, Boards (landing, board and card drawer), Settings pages and ⌘K.
- I measured the stylesheet with a script: font sizes, radii, colours, `!important`, inline styles, durations and weights.
- I checked contrast numerically for every text token pair, then checked uppercase text, focus and keyboard reach in the browser.

### The CSS in numbers (before v3)

| Measure | Count | Notes |
|---|---|---|
| Distinct font sizes | 34 | 7px to 52px, including 8, 8.5, 9, 9.5, 10.5, 11.5, 12.5, 13.5 |
| Distinct border radii | 21 | 1px to 980px. 8px is used 156 times, 6px 59 times, then a long tail |
| Distinct hex colours | 255 | Many are one-off Material tints |
| `!important` | 282 | Mostly in the v2.39 to v2.42 layers, fighting the base sheet |
| Inline `style=` | about 1,600 | Concentrated in render functions |
| Box-shadow recipes | 55 | Five "card" shadows that are almost the same |
| Transition durations | 17 | .1s, .12s, .14s, .15s, .18s, .2s, .22s, .24s, .26s, .28s, .3s… |
| Font weights | 400, 500, 600, 650, 700 | 650 is a variable-font in-between weight, used 12 times |

There are seven `:root` blocks across the layers (base, v2.31 cool, v2.36, v2.38 beige, v2.39, consistency layer, design language v2). What you see on screen is whichever block wins the cascade, which makes the app hard to change safely.

## Findings, screen by screen

Severity: **H** looks broken or blocks use, **M** is clearly inconsistent or unclear, **L** is polish. "Fixed" means fixed in this pass, by the system or by a surgical edit. "Screen pass" means it's left for the screen redesign.

### App shell (all screens)

- **H. Fixed.** Secondary text failed WCAG AA. `--muted #8D887C` measured 3.2:1 on the paper and 3.5:1 on white, and it's the most-used text colour after ink. It's now `#6F6A5E`: 4.8:1 on paper, 5.4:1 on white.
- **H. Fixed.** The sidebar couldn't be reached by keyboard. Nav items were `div`s with no role or tabindex. They're now `role=button`, focusable, labelled, answer Enter and Space, and carry `aria-current="page"`. The rail expands while it holds keyboard focus.
- **M. Fixed.** The active nav state was a 3px red tick on the window edge plus a red icon. It read as "something is wrong" more than "you are here". It's now a white pill with a red edge that glides between items on a spring.
- **M. Fixed.** There were no focus rings. `:focus` was removed in places and most controls showed nothing. There's now one `:focus-visible` outline on everything (ink-red, 2px, offset 2), and fields get a soft red ring.
- **M. Fixed.** The dark mode was a cool neutral grey (`#19191B`, `#242427`, `#F2F2F4`), the Apple grey the brand rejected in light mode in v2.31. It's now warm charcoal (`#191714` window, `#221F1B` surface, `#F2EEE6` text) with warm hairlines.
- **M. Fixed.** Toasts stacked on top of each other in the same spot, so two quick actions hid the first message. Each status also painted the whole toast (green, red, orange). They now stack upwards, slide in, slide out, and stay one ink capsule with a coloured icon. Success icons pop.
- **M. Fixed.** Tooltips were native `title`s: slow, unstyled and different in every browser. Icon buttons now get a fast, styled tooltip. The `title` moves to `aria-label` when the button has no text.
- **L. Fixed.** There was no slot for a future product mark. The logo now sits in a workspace block (`.ds-ws`) that shows "Content & Co · Workspace" when the rail expands. A Rosila mark can drop in later without layout work.
- **L. Fixed.** Switching theme made hundreds of elements run their own colour transitions at different speeds. Now the whole page cross-fades once, using View Transitions.
- **L. Fixed.** "Wallpaper set — hello, glass" and the wallpaper hint still promised frosted glass, which was removed on purpose. The toast now says "Wallpaper set".

### Dashboard

- **M. Fixed.** The KPI cards re-ran their entrance on every visit, because `renderDashboard` rebuilds the DOM and `.kpi-row .kpi` carried an animation. Entrances now run once per session: on the first paint, after the splash, with a 40ms stagger and the numbers counting up.
- **M. Fixed.** There were three label styles on one screen: uppercase 11px KPI labels, the uppercase "YOUR DAY" section label and the uppercase "WEEKLY CHECK-IN" eyebrow. Labels are now sentence case. Section labels are 15px display type, and the check-in eyebrow is red ink.
- **L. Fixed.** The KPI numbers (28–32px/650) didn't carry the screen. They're now 36px/750 display type with tight tracking.
- **L. Screen pass.** The greeting area and the "Your day" list are visually flat. The screen pass should give the dashboard one hero moment (today's load against capacity) rather than three equal tiles.

### To Do (week, calendar, Today, task modal)

- **H. Kept on purpose.** The card heights, drag, resize, split seams and the done divider are untouched. v3 only changes the cards' radius, border colour, shadow and hover.
- **M. Fixed.** The task modal mixed field styles: paper-filled inputs (title, hours, day) next to white bordered selects (job, item). All fields are now one spec: white, 34px, 10px radius, red focus ring. The title field is larger.
- **M. Fixed.** Form labels were uppercase 10px with wide tracking. They're now sentence case, 12px, weight 500.
- **M. Fixed.** Ticking a task done gave no feedback on the board itself. There's now a green pulse on the card and a check burst where you clicked. It works for every done path (context menu, drag to Done, Today list), because it diffs the done set between renders rather than hooking each path.
- **M. Fixed.** In dark mode, the "View done" buttons on the green Done tiles were light-grey slabs. They're now quiet translucent buttons.
- **L. Fixed.** The "You're viewing someone's To Do" banner was a near-black slab with grey text, from the old dark chrome. It's now an info-tinted rounded banner.
- **L. Screen pass.** When someone is over capacity every day, each day header is filled with `--warn-bg`, so the whole header row turns orange (brown in dark). A thinner signal, such as the existing meter turning orange, would read better.
- **L. Screen pass.** The calendar view's empty "+" is invisible until hover (listed in the platform review too).

### Jobs list, Items, Time, Expenses, Quotes, Invoices

- **M. Fixed.** There were four table-header styles: uppercase 10.5px tracked, uppercase spans in the quotes header (`.qinv-head-row span`), uppercase `items-t` headers in job detail, and sentence case in Reporting. There's now one: sentence case, 11.5px/600, muted, on `--surface-2`.
- **M. Fixed.** Status pills mixed UPPERCASE ("AWAITING"), lowercase ("draft", "approved") and Title case ("Live job"). They're all sentence case now, through `::first-letter` on an inline-block pill, so the stored values and filters don't change.
- **M. Fixed.** The tab bar underline was a hard 2px border that jumped between tabs. It's now a rounded 2.5px red bar that grows in from the centre. The tabs are bigger (13.5px) and keyboard focusable, with `role=tab` and `aria-selected`.
- **L. Fixed.** Selects drew a hard grey chevron that looked wrong in dark mode. Each theme now has its own chevron colour.
- **L. Screen pass.** The Items toolbar wraps "Export CSV" onto a second line at 1440px. The filters need a "More filters" overflow.
- **L. Screen pass.** The Jobs footer bar (total, budget meter) floats as a separate card under the table. It would read better as the table's footer row.

### Job detail

- **M. Fixed.** The phase item headers ("ITEM", "TEAM", "HOURS") were uppercase while the expenses table under them was sentence case. Both are sentence case now.
- **L. Fixed.** The "← Jobs" back link and its hover used a hard-coded `#eeecea` that flashed light in dark mode. It's now a rounded pill on tokens.
- **L. Screen pass.** The stat strip (time used, sell used, budget, invoiced, expenses) uses 18px values in thin columns. It should share the KPI tile anatomy.

### Clients, Deadlines

- **H. Fixed.** On Deadlines, the calendar's columns were sized by their content (`repeat(7,1fr)` with no-wrap event pills), so Wednesday and Thursday shrank to half width. It now uses `minmax(0,1fr)`, so every column is equal.
- **M. Fixed.** Deadline events were solid brown and solid red slabs with white text, which used red as paint. They're now tinted chips (warn tint for job due dates, danger tint for invoices). Today is a red date disc instead of a red outline box, and the grid has rounded corners.
- **L. Fixed.** Client cards lift on hover with the shared elevation.

### Schedule

- **L. Fixed.** Range chips (1 week, 2 weeks, 4 weeks) and the People/Studio toggle now use the segmented and chip specs.
- **L. Screen pass.** The person column is quiet next to the dense day cells. Done items at 0.5 opacity plus strikethrough are hard to read in dark mode.

### Reporting (chrome only)

- **L. Fixed.** The tab group (`.r-tabs`) is now the shared segmented control, and KPI labels match the dashboard.
- Chart internals were not touched (`_applyChartTheme`, Chart configs, `report-v2-script` builders).

### Boards

- **M. Fixed.** The landing title sat 16px further right than every other page title, because `#boards-landing` used 34px padding against the 28px gutter. It now uses the shared `--gutter`.
- **L. Fixed.** Template tiles and board tiles lift on hover. The empty-state art matches the system's empty-state icon well.
- **L. Fixed.** The card drawer now uses the system's spring entrance and modal radius.

### Settings

- **M. Fixed.** Card headers were uppercase micro labels, and the count ran into the title ("ACTIVE MEMBERS16" became "Active members16" once tracking dropped). Headers are now 14px display type with an 8px gap before the count.
- **M. Fixed.** The Identity field labels ("DISPLAY NAME", "ROLE / TITLE") were uppercase. They're sentence case now. Labels that wrap a checkbox are left alone.
- **L. Fixed.** The active item in the side nav now matches the main nav pill.
- **L. Fixed.** The wallpaper row said "the whole window becomes frosted glass over it". It now says "Set a background image to show around the window".

### Modals, menus and ⌘K

- **M. Fixed.** There were five modal radii (6, 8, 14, 16, 18px) and four shadow recipes. Every modal is now 20px with elevation 4, and opens with a short spring (scale 0.965 to 1, rising 14px, 320ms).
- **M. Fixed.** Menus and popovers (context menu, person menu, calendar popup, view settings, combo dropdowns, board popovers, assign menu) had 5–8px radii, 0–4px padding and full-bleed hover rows. They now share one spec: 14px radius, 6px padding, 8px rounded rows and a 180ms pop-in.
- **L. Fixed.** In ⌘K the search icon is now red, the input is bigger, category labels are sentence case, rows are rounded, and keyboard hints match `kbd` everywhere.
- **L. Open.** On first run, "What's new" and "Who are you?" open on top of each other. Who-are-you should come first and What's new after. That's a flow change, so it's left for the screen pass.

## Design system v3

All of it is in `<style id="ds-v3">`, placed after every other style block, with behaviour in `<script id="ds-v3-script">`. New UI should use these tokens and the component classes they style. The older layers are legacy: delete them piece by piece, checking the screen each time.

### Principles

1. **Warm paper, warm charcoal.** Neutrals come from the paper in both themes. No blue greys.
2. **Red is a signal.** Red marks the active nav edge, today, focus, live dots, destructive actions and drop targets. Body text that has to be red uses `--red-ink`, which passes AA.
3. **One accent per context.** Use one ink primary per context and outline everything else.
4. **Rounded, scaled to the object.** Radius grows with size: chip, control, card, modal.
5. **Labels are quiet and in sentence case.** Uppercase is only for calendar day names.
6. **Motion confirms.** It's fast, eases out, is never in the way and plays once. With reduced motion it's off.

### Tokens

**Colour roles** (light / dark)

| Role | Token | Light | Dark |
|---|---|---|---|
| Desk (behind the window) | `--desk` | `#E6E0D4` + red-warm radial | `#0F0E0C` + red-warm radial |
| Window | `--off` | `#F4F1EA` | `#191714` |
| Surface (cards, modals) | `--white` | `#FFFFFF` | `#221F1B` |
| Inset / hover / table head | `--surface-2` | `#FAF8F3` | `#282520` |
| Text | `--ink` | `#1C1A16` (15.6:1) | `#F2EEE6` |
| Secondary text | `--ink-2` | `#4A463E` | `#D3CDC2` |
| Muted text | `--muted` | `#6F6A5E` (4.8:1) | `#A9A296` (6.6:1) |
| Decorative only | `--subtle` | `#A39D90` | `#6E685D` |
| Hairline | `--faint` | `#ECE7DE` | `#2C2924` |
| Border | `--border` / `--border-strong` | `#E1DACD` / `#CBC3B4` | `#3A362F` / `#4F4A40` |
| Brand red | `--red` | `#ED1E24` | `#F04A4F` |
| Red as text | `--red-ink` | `#C8161B` (5.2:1) | `#FF8A8C` |
| Success | `--ok` / `--ok-ink` / `--ok-bg` | `#3E9B48` / `#2B6E31` / `#E6F2E4` | `#6BBF73` / `#93D69A` / 15% tint |
| Warning | `--warn` / `--warn-ink` / `--warn-bg` | `#E08A00` / `#A04A06` / `#FCEFD9` | `#F0A030` / `#F5B661` / 15% tint |
| Info | `--info-ink` / `--info-bg` | `#1F5FA8` / `#E4EEF8` | `#7DB4EE` / 15% tint |
| Danger | `--danger-ink` / `--danger-bg` | `#B3261E` / `#FBE7E4` | `#FF8F86` / 15% tint |

The old names (`--white`, `--off`, `--ink`, `--muted`, `--faint`, `--border`, `--shadow-s/m/l`) keep working: they are redefined here, so everything built on them follows. `--warn-ink` moved from `#E65100` (3.5:1 on its tint) to `#A04A06` (4.9:1).

**Type.** Inter Tight for display and big numbers, Inter for UI, with the `cv11`, `ss01` and `ss03` alternates.

| Step | Use |
|---|---|
| 40 / 750 / -0.045em | Dashboard greeting |
| 36 / 750 / -0.045em | KPI value |
| 30 / 750 / -0.04em | Page title (`.view-title`, `.boards-head`, `.sett-tab-hd`) |
| 28 / 750 | Detail title |
| 18 / 700 | Modal title, empty-state title |
| 15 / 700 | Section label, card title (`.att-title`) |
| 14 / 700 | Settings card header |
| 13.5 / 400 | Page subtitle, tabs |
| 13 / 400–600 | Body, buttons, inputs, menu rows |
| 12.5 / 600 | KPI label |
| 12 / 500 | Form label, tooltip |
| 11.5 / 600 | Table header, micro label |
| 11 / 600 | Pill |

**Spacing.** It's on a 4px base: `--s-1` 4, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-5` 20, `--s-6` 24, `--s-7` 28, `--s-8` 32, `--s-10` 40, `--s-14` 56. Page gutter: `--gutter` 28px.

**Radii.** `--r-xs` 6 (skeleton, kbd), `--r-sm` 8 (menu rows, small square buttons), `--r-ctl` 10 (buttons, inputs, segmented), `--r-card` 16 (cards, tables), `--r-lg` 20 (modals, drawers, palette, window, sidebar), `--r-pill` 999 (pills, chips, nav back link).

**Control heights.** `--ctl-h` 34px, `--ctl-h-sm` 28px.

**Elevation.** Shadows are warm-tinted and layered, and stronger in dark mode.

| Level | Token | Use |
|---|---|---|
| 1 | `--e-1` | Cards, tables, controls at rest |
| 2 | `--e-2` | Hovered cards, empty-state icon |
| 3 | `--e-3` | Menus, popovers, tooltips |
| 4 | `--e-4` | Modals, drawers, palette, toasts |

**Motion.**

| Token | Value | Use |
|---|---|---|
| `--d-1` | 120ms | Colour and border changes, press |
| `--d-2` | 180ms | Menus, fades, tooltips |
| `--d-3` | 240ms | View cross-fade, tab underline |
| `--d-4` | 320ms | Modals, drawers, toasts, nav marker, check pop |
| `--ease-out` | `cubic-bezier(.16,1,.3,1)` | Entrances |
| `--ease-std` | `cubic-bezier(.2,0,0,1)` | Utility |
| `--ease-spring` | `cubic-bezier(.34,1.36,.64,1)` | Things that land: modals, the nav marker, check pop |

Two motions run longer on purpose. The KPI count-up runs about 620ms, because a number counting in 300ms just flickers. The splash's red thread draws over about 1.1s, under the existing 1.8s cap. Neither blocks input.

### Components (what each class now looks like)

| Component | Classes styled | Spec |
|---|---|---|
| Primary button | `.d-action.primary`, `.tb-btn`, `.modal-save`, `.modal-ok`, `.tm-btn-save`, `.save-b`, `.cb-create-btn`, `.cal-today-btn`, `.r-export-btn`, `.bv-act.primary` | Ink fill, 34px, r10, 13/600. Hover rises 1px with a faint red glow. Press scales to 0.97. Inverts in dark |
| Secondary button | `.d-action`, `.filter-btn`, `.p-btn`, `.modal-cancel`, `.tm-btn-cancel`, `.tm-btn-timer`, `.bv-act`, `.rv-act` | White, 1px border, e-1, 13/500. Hover gets `--border-strong` and `--surface-2` |
| Destructive | `.modal-save.danger`, `.tm-btn-delete` | Red fill for the confirm. Danger-ink text button for an inline delete |
| Icon button | `.wbtn`, `.mini-cal-nav-btn`, `.cc-icon-btn`, `.rf-icon-btn`, `.bv-ibtn` | r8, with a styled tooltip from `title` |
| Input / select | `.form-inp`, `.field input/select/textarea`, `.cc-select`, `.jobs-search input`, `.tm-*` fields, `.bv-search` | White, 34px, r10. Hover `--border-strong`. Focus: red-mixed border plus a 3px red ring |
| Segmented | `.todo-view-toggle`, `.r-tabs`, `.c2-seg` | Inset track. Selected segment is white with e-1 |
| Chip toggle | `.sched-pick-btn` | 28px pill. Selected is ink |
| Tabs | `.jsn-tab`, `.d-tab` | 13.5/500, muted. Active is ink/600 with a rounded red bar that grows in |
| Side nav | `.sett-nav-item`, `.s-btn` | r10–12 rows. Active is a white pill (the sidebar's pill glides) |
| Pill / badge | `.inv-pill`, `.wf-badge`, `.exp-badg`, `.i-badge`, `.task-status`, `.rv-pill`, `.fd-pill`, `.fe-pill`, `.c2-chip`, `.bv-chip`, `.st-tag` | Inline-block pill, 11/600, sentence case, status tints |
| Card | `.kpi`, `.att-card`, `.time-stat`, `.client-card-full`, `.team-card`, `.hp-card`, `.sett-card`, `.my-todos`, `.rv-card`, `.bv-tile`, `.bv-tpl`, `.alert` | White, 85% border, r16, e-1. Clickable cards lift 2px to e-2 |
| KPI tile | `.kpi` (+ `.kpi-label`, `.kpi-val`, `.kpi-sub`, `.kpi-bar`) | Label 12.5/600 muted, value 36/750 display, context 12.5 muted, then a 6px meter |
| Table | `.jobs-table`, `.inv-table`, `.time-table`, `#exp-list-wrap`, `.qinv-*`, `.items-t`, `.prog-table` | r16 card wrapper. Header 11.5/600 sentence case on `--surface-2`. Rows `--faint` hairline, hover `--surface-2` |
| Progress | `.kpi-bar`, `.bbar-track`, `.stat-bar`, `.r-bar`, `.tm-bar`, `.c2-bar`, `.cc-mi-bar`, `.rf-ts-bar`, `.bv-prog` | 6px pill track on `--faint` |
| Empty state | `.empty-state` (via `emptyStateHTML`), `.bv-empty` | 64px tilted icon tile on e-2, 18/700 title, 13px sub (max 360), one primary CTA |
| Menu / popover | `.ctx`, `.pctx`, `.task-ctx-menu`, `.ps-menu`, `.cal-popup`, `.vsp`, `.combo-dd`, `.bv-pop`, `.tm-assign-menu` | r14, 6px padding, e-3, r8 rows, 180ms pop |
| Modal | `.modal`, `.tm-modal`, `.cl-modal`, `.inv-modal`, `.cb-modal`, `.rf-tm-modal`, `.fe-imp-modal` | r20, e-4, 24px padding, 18/700 title, the close button turns 90° on hover, spring in |
| Drawer | `.detail-drawer`, `.tm-detail-panel`, `.bv-drawer` | r20 on the leading edge, e-4, 320ms ease-out slide |
| Toast | `toast(msg,type)` | Stacked bottom-right, ink capsule, coloured icon, spring in and slide out. Capped at 4 |
| Tooltip | any icon button with `title` | Ink, 12/500, r8, 380ms delay, flips above near the bottom edge |
| Avatar | `.person-av`, `.tc-av`, `.tcm-pav`, `.c2-av`, `.bv-av`, `.rf-av` | 2px surface ring so stacks read cleanly |
| Skeleton | `.skel`, `.ds-skel` | Warm shimmer from `--faint` to surface, both themes |

### App shell

- **Desk and window.** The window (`.main`) floats 10px from the edges with a 20px radius, a warm double shadow and a 1px inner highlight. The desk has a faint red-warm glow at top right in both themes.
- **Sidebar.** A 64px paper rail with a 20px radius, expanding to 220px over the content on hover or keyboard focus. The workspace slot sits at the top. The active marker glides on a spring. Icons nudge on hover and squash on press. The theme icon tilts on hover.
- **Page header.** Page title (30/750) above the subtitle (13.5 muted) above the toolbar (34px controls), then the content card. The gutter is 28px on every page, Boards included. The Jobs-area tab bar sits at the top of the window, 52px tall.
- **Content width.** Dashboard content caps at 1400px. Tables use the full width.
- **Splash.** The red C&C mark on paper, with a red thread drawing underneath while the app wakes. It's still capped at 1.8s.

### Motion and delight

| Moment | What happens | Where |
|---|---|---|
| View change | Cross-fade plus an 8px rise, 240ms | `.view`, `.jt-panel`, active settings tab |
| First visit to a view | Cards stagger in 40ms apart and big numbers count up. Once per view per session, so re-renders never replay it | `dsEnter()` / `.ds-enter` |
| Theme switch | One whole-page cross-fade | `toggleTheme` wrapped with View Transitions |
| Nav | The active marker glides between items on a spring | `.ds-nav-ind` |
| Tabs | The red underline grows from the centre | `.jsn-tab::after` |
| Press | Buttons and segments scale to 0.97 in 60ms | All buttons |
| Hover | Clickable cards rise 2px to e-2, primaries glow faintly red | Cards, primaries |
| Modal / drawer | Spring in (0.965 to 1, rising 14px), backdrop fades | All modals |
| Menus | 180ms pop from 4px above | All menus |
| Toast | Spring up, slide out to the right | `toast()` |
| Task done | Card pulse, plus a green check burst where you acted | `renderTodo` diff |
| Success toast | The check icon pops | `.toast-success` |
| Loading | Warm shimmer skeletons | `.skel` |

With `prefers-reduced-motion: reduce`, all animation and transition durations collapse to near zero. The count-up and the burst don't run.

### Accessibility changes

- Every text token passes AA, including the dark-mode muted text (6.6:1) and red used as text (`--red-ink`).
- `:focus-visible` outlines are on every control, and fields get a ring.
- The sidebar, tabs, settings nav, check-in faces, needs-attention rows, Your-day rows, client and team cards, and board tiles are keyboard focusable, with roles, `aria-current` and `aria-selected`. Enter and Space activate anything with `role=button` or `role=tab`.
- Toasts live in a polite `role=status` region.
- Icon buttons with only a `title` get an `aria-label`.
- Checkboxes, dates and selects follow the theme (`color-scheme: dark`, accent colour).

## Left for the screen-redesign pass

1. **Dashboard hero.** Give the dashboard one bold "today" moment (load against capacity, with the Your-day list as the main act) rather than three equal KPI tiles.
2. **Job detail stat strip.** Move it onto the KPI tile anatomy, and make the phase tables one table component with the expenses table.
3. **Jobs footer.** Make it the table's footer row.
4. **Items and Jobs toolbars.** Add a filter overflow, so nothing wraps at 1440px.
5. **Over-capacity day headers.** Signal through the meter, not a full-header tint.
6. **First run.** Show "Who are you?" before "What's new", never both at once.
7. **Copy.** Fix the remaining Title Case ("In Play", "Group by Company").
8. **Inline styles.** About 1,600 remain. Each render function the screen pass touches should move its inline styles onto the v3 classes, so `ds-v3` can drop its `!important`s over time.
9. **Legacy CSS.** Once a screen is rebuilt, delete its rules from the base sheet and the v2.29–v2.42 layers. The tokens in `ds-v3` are the only `:root` the app needs.
10. **Stat tiles.** Time's stat tiles put the label under the number, but the KPI tiles put it above. Pick the KPI anatomy everywhere.
11. **Invoice document bug.** Hours print unrounded ("5.3333333333333h" on INV-5883's retainer lines). This is a formatting bug in the document template, not a style issue.
12. **Tiny type.** 8, 9 and 10px text still appears in inline styles (drop-dock day names, split seams, a few meta lines). Raise them to 11px when those templates are touched.
