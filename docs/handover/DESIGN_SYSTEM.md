# C&C Platform — Design System

Handover reference for the team taking over the front end (Razor, from Dec 2026).
Written against `index.html` at **v2.38.1** (commit `b6f7efb`). All line numbers refer to that commit. If later edits have shifted them, open `git show b6f7efb:index.html` or search for the quoted class or function name.

The app is one file. All CSS is in the `<style>` block (lines 13–1664). The design was built up in
layers: the base rules at the top are the oldest, and the dated blocks further down (`v2.29` … `v2.38`)
override them. **What you see on screen is the result of the whole cascade.** This document gives
the *effective* values: the ones that actually render today. Where an old value still sits in the
file but gets overridden, it is called out as superseded.

> Quick orientation in the stylesheet
>
> | Lines | Block |
> |---|---|
> | 14–1338 | Base layer (oldest). Tokens at 15–30, then per-feature rules |
> | 1340–1356 | v2.29 radius consolidation |
> | 1358–1375 | v2.29 motion system + reduced-motion rule |
> | 1377–1382 | v2.29 task-card text fade |
> | 1384–1420 | v2.30 search, skeletons, button depth, caret, toasts |
> | 1422–1484 | v2.31 "new skin": floating window, pill primaries, light modal headers (its cool-grey palette was later reverted) |
> | 1486–1504 | v2.32 column picker, drag-to-schedule strip (drop dock) |
> | 1506–1538 | v2.33 floating pill sidebar, boards restyle, task drop dock |
> | 1540–1557 | v2.34 split zones, "red thread" accents |
> | 1559–1612 | v2.35 dark mode |
> | 1614–1622 | v2.36 Inter Tight display face, splash |
> | 1624–1636 | v2.38 focus mode |
> | 1638–1653 | v2.38 **beige restored** (current light palette) |
> | 1655–1663 | v2.38 wallpaper / glass mode |

---

## 1. Principles

1. **Warm paper, never clinical.** The identity is C&C beige. Surfaces are warm off-white (`--off #F4F2EC`)
   and white cards on a warm radial "desk" gradient. A cool Apple-grey palette was tried in v2.31 and
   **rejected by the client as clinical**. Don't bring back cool greys, blue-tinted hovers or slate neutrals.
2. **Floating glass panels.** The app is two floating objects on a desk: a frosted pill sidebar and a
   rounded content window. Overlays (modals, search, the drop dock) float above with soft deep shadows
   and a blurred backdrop. Content cards stay solid so text stays readable.
3. **Red is a signal, not a paint.** Brand red `#ED1E24` marks *where you are* and *what's alive*: the
   active nav rail and icon, today markers, the text caret, focus rings, the selected search row, the hover
   glow on primary buttons, drop targets, and short dividers like the 56×3px rule under the dashboard
   greeting. Never use it for large fills or decoration. (The red full stop after headings was tried and
   **removed** in v2.38. Don't add it back.)
4. **Two typefaces, clear jobs.** *Inter Tight* (`--display`) for titles, headings and big numbers.
   *Inter* (`--font`) for everything else. Hierarchy comes from size, weight and tight tracking on display
   type, plus wide tracking on uppercase micro labels.
5. **Pill = primary, rectangle = secondary.** One filled near-black pill per context for the main action.
   Everything else is an outlined rectangle at `--r-ctl`.
6. **Motion is fast and subtle.** 120–280 ms, ease-out springs (`cubic-bezier(.16,1,.3,1)`), small
   distances (6–10 px rises, 2 px lifts, a 0.985 press). Motion should confirm what happened, never put on
   a show.
7. **Respect the user.** Honour `prefers-reduced-motion` (line 1375). Every colour goes through a token so
   dark mode and glass mode work for free. Numbers use tabular figures. Bold and considered, not busy.

---

## 2. Tokens (effective values)

Tokens are CSS custom properties. `:root` is defined four times (15, 1428, 1616, 1640). The table shows
the value that wins. Dark mode is `body.dark` (1563). `body.dark` (specificity 0,1,1) beats `:root` (0,1,0),
so it wins no matter where it sits in the file.

### 2.1 Colour

| Token | Light (effective) | Defined at | Dark (`body.dark`, 1564–1569) | Use |
|---|---|---|---|---|
| `--red` | `#ED1E24` | 16 | same | Brand accent (see Principle 3) |
| `--black` | `#0D0D0D` | 16 | same | Fill for `.d-action.primary` and `.tb-btn` (see §8, two near-blacks) |
| `--white` | `#FFFFFF` | 16 | `#242427` | Card / panel surface. **In dark mode this is not white.** Treat it as "surface" |
| `--off` | `#F4F2EC` | 1641 | `#19191B` | Window background, wells, hover fills, input fill |
| `--ink` | `#1D1C19` | 1641 | `#F2F2F4` | Primary text. **Flips to near-white in dark mode** |
| `--muted` | `#8D887C` | 1641 | `#9C9CA3` | Secondary text, labels, icons |
| `--faint` | `#EBE7DE` | 1641 | `#2A2A2E` | Row hairlines, progress tracks, skeleton base |
| `--border` | `#E2DDD2` | 1641 | `#37373C` | Card and control borders |
| `--done` / `--done-ink` | `#C8E6C9` / `#2E7D32` | 23 | `#23402A` / `#8FD79A` | Completed task fill / text |

**Desk (page) background, not a token:**

- Light: `radial-gradient(1100px 720px at 88% -8%, #F0E5DE 0%, #E8E4DB 55%)` (1643)
- Dark: `radial-gradient(1100px 720px at 88% -8%, #2A1A1B 0%, #101012 55%)` (1573)

**Fixed surface colours with no token (current values):**

| What | Light | Line |
|---|---|---|
| Sidebar glass | `rgba(248,246,240,.72)`, hover `.9` | 1644–1645 |
| Table / progress row hover | `#FAF8F3` | 1646 |
| Pressed hover (expense head, back button) | `#EBE7DE` | 1647 |
| Done divider bar | `#EAE6DD`, border `#D9D4C8` | 1648 |
| Scrollbar thumb | `#D4CFC2`, hover `#BDB6A6` | 1649–1650 |
| Input placeholder | `#B8B3AB` | 1259 |
| Text selection | `rgba(237,30,36,.14)` (dark `.3`) | 1374, 1607 |

#### Superseded colour values (do not use)

| Token | Old values in file | Lines |
|---|---|---|
| `--off` | `#F6F4EF` (v1), `#F5F5F7` (v2.31 cool) | 16, 1429 |
| `--ink` | `#191714`, `#1D1D1F` | 17, 1429 |
| `--muted` | `#8A857C`, `#86868B` | 17, 1429 |
| `--faint` | `#ECE9E2`, `#EDEDF0` | 17, 1429 |
| `--border` | `#E3DFD6`, `#E4E4E9` | 17, 1429 |
| `--display` | `'Inter'` | 29 (now Inter Tight, 1616) |

### 2.2 Semantic status colours

Defined at 24–28 (light) and 1566–1569 (dark). **Use these for any status UI.** Don't use the raw
Material hexes that appear throughout the JS (see §8).

| Meaning | Solid | Ink (text on tint) | Background tint | Dark ink / tint |
|---|---|---|---|---|
| OK / billable / paid / live | `--ok #4CAF50` | `--ok-ink #2E7D32` | `--ok-bg #E8F5E9` | `#8FD79A` / `rgba(102,187,106,.15)` (dark `--ok` = `#66BB6A`) |
| Warning / non-billable / sent | `--warn #FF9800` | `--warn-ink #E65100` | `--warn-bg #FFF3E0` | `#FFB74D` / `rgba(255,152,0,.14)` (`--warn` unchanged) |
| Info / approved / invoiced | — | `--info-ink #1565C0` | `--info-bg #E3F2FD` | `#64B5F6` / `rgba(33,150,243,.15)` |
| Danger / overdue / new | — | `--danger-ink #C62828` | `--danger-bg #FFEBEE` | `#FF8A80` / `rgba(244,67,54,.16)` |
| Urgent / over capacity | `--red` | `--red` | `rgba(237,30,36,.05–.13)` | same |

How status maps to the domain, consistently across the board, dashboard and job bars:

- **Billable = green** (`--ok`)
- **Non-billable = orange** (`--warn`)
- **Urgent / over budget = red** (`--red`)
- **Done = soft green fill** (`--done`)

Task cards show status *only* through a 3px left border (194–196).

**Category accents in use** (no tokens yet, see §8):

- Slate `#6B7FA3`: Streamtime-origin activity and quotes awaiting response
- Sage `#7B9E87`: comments, "to do" bucket, complete
- Tan `#C4956A`: paused
- Purple `#9C6FD6` / `#6A1B9A`: invoiced / uninvoiced
- Global-search category tints: 1392–1397

### 2.3 Radii

| Token / value | Effective | Where | Use |
|---|---|---|---|
| `--r-ctl` | **9px** (1430; was 7px at 19) | Buttons (secondary), inputs, selects (1342–1346, 1328) | All controls |
| `--r-card` | **16px** (1430; was 12px at 19) | `.kpi`, `.team-card`, `.sett-card`, `.r-kpi`, `.pboard-lane` and others | Content cards |
| `980px` (pill) | literal | 1470 | Primary buttons |
| 22px | literal | `.sidebar` 1508 | Sidebar pill |
| 18px | literal | `.main` 1438, modals 1468, `.gs-panel` 1466 | Window and overlays |
| 16px | literal | `.sched-strip` 1497, board columns 1513 | Dock, wells |
| 12px | literal | board/client cards 1518–1520, `.colpick` 1490, attention cards 4173 | Small floating cards |
| 10px | literal | menus `.ctx .ps-menu .cal-popup .vsp …` 1348, `.item-pick-dd` 1170, `.alert` 111 | Popovers / menus |
| 11px | literal | dock tiles `.ss-day` `.ss-person` 1500, 1532 | Dock targets |
| 9px | literal | `.s-btn` 39, toasts 1419 | Nav items, toasts |
| 8px | literal | `.task-card` 189 | To Do task cards |
| 6px | literal | `.day-add-btn`, `.sf-btn` 1347 | Small chips |
| 20px | literal | status pills 238, 787, 984 | Pills / badges |
| 50% | literal | avatars, check circles | |

### 2.4 Shadows (effective: v2.31, 1431–1433)

| Token | Light | Dark (1570–1572) | Use |
|---|---|---|---|
| `--shadow-s` | `0 1px 2px rgba(0,0,0,.04), 0 2px 8px rgba(0,0,0,.04)` | `0 1px 2px rgba(0,0,0,.4), 0 2px 8px rgba(0,0,0,.35)` | Resting cards |
| `--shadow-m` | `0 2px 8px rgba(0,0,0,.05), 0 12px 32px rgba(0,0,0,.09)` | `… .45 / .5` | Hovered cards, dropdowns |
| `--shadow-l` | `0 8px 24px rgba(0,0,0,.09), 0 32px 80px rgba(0,0,0,.18)` | `… .5 / .6` | Modals, drawers, dock |

Fixed floating shadow for the window and sidebar:
`0 4px 18px rgba(0,0,0,.05), 0 18px 60px rgba(0,0,0,.08)` (1438, 1508).

Primary button depth: `0 1px 2px rgba(25,23,20,.22), inset 0 1px 0 rgba(255,255,255,.07)` (1407).
On hover: `0 1px 3px rgba(0,0,0,.2), 0 4px 20px rgba(237,30,36,.28)`, the red glow (1552).

(The warm-tinted originals `rgba(35,28,18,…)` at 20–22 are superseded. See §8.)

### 2.5 Fonts

| Token | Value | Line |
|---|---|---|
| `--font` | `'Inter', -apple-system, sans-serif` | 29 |
| `--display` | `'Inter Tight', 'Inter', -apple-system, sans-serif` | **1616** (overrides 29) |

- Loaded from Google Fonts at line 12: Inter 400/500/600/700 (static) and Inter Tight 500–800 (variable).
- Weight 650 is only valid on `--display` text. On Inter it falls back to 700.
- Body: 13.5px / 400, `-webkit-font-smoothing: antialiased`, `optimizeLegibility` (31).
- Icons: Tabler Icons webfont (`<i class="ti ti-…">`, line 8), used about 280 times. Lucide (line 9) is
  used only for task-card item icons (`_icon()`, 5399–5402).

---

## 3. Typography scale

Display face = Inter Tight via `var(--display)`. Everything else is Inter.

| Role | Class(es) | Size / weight | Tracking | Other | Lines |
|---|---|---|---|---|---|
| Hero number (Focus mode day) | `.focus-daynum` | 52px / 700 display | -.035em | `--red`, lh 1 | 1630 |
| Dashboard greeting | `.dash-greeting` | **31px** / 650 display | **-.032em** | lh 1.15, mb 6px | 74, 1482 |
| View title | `.view-title` (+ older twins `.detail-title`, `.sett-tab-hd`, `.boards-head`, `.report-head`) | 22px / 650 display | -.025em | lh 1.2 | 76, 249, 355, 447, 658, 1483 |
| KPI number | `.kpi-val` | 28px / 650 display | -.025em | tabular-nums | 84, 1484 |
| Big stat numbers | `.r-big` 26/650, `.ts-val` 24/650, `.ps-val` 20/600, `.stat-val` 19/600 | display | -.02em to -.01em | tabular-nums | 422, 723, 532, 270 |
| To Do day number | `.day-num` | 22px / 650 | -.02em | today = `.today-red` | 142, 1554 |
| Modal title | `.modal-hd-title` | 16px / 600 display | -.02em | | 557, 1451 |
| Card / empty-state title | `.es-title`, `.blc-name` (17px), `.cal-label` | 16px / 600 display | -.01em | | 1311, 457, 887 |
| Body | `body` | 13.5px / 400 | — | | 31 |
| Row / item text | `.job-name`, `.tc-name`, `.i-name` | 14px / 400 | | | 231, 100, 298 |
| Task card title | `.tc-title` | 13px / 400 | | lh 1.35 | 201 |
| Sub-heading under a title | `.view-sub`, `.dash-date` | 12px / 400 muted | .06em | mt 3px | 77, 78 |
| Caption / meta | `.kpi-sub`, `.job-co` (12px); `.tc-job`, `.todo-meta`, `.tc-meta` (11px) | 400 muted | | | 85, 232, 206, 121 |
| **Section label** (uppercase micro + rule) | `.section-label` | 11px / 500 muted | .09em | uppercase, `::after` 1px hairline fills the row | 88, 94 |
| Card label | `.kpi-label`, `.sett-card-hd` (600) | 11px / 500 | .08–.09em | uppercase muted | 83, 661 |
| Field / micro label | `.micro-lbl`, `.field label`, `.stat-label` | 10px | .08–.1em | uppercase muted | 90, 562, 269 |
| Table header | `.jobs-table thead th` | 10px / 500 | .13em | uppercase muted, sticky | 225 |
| Day-name / smallest label | `.day-name`, `.tm-lbl`, `.ssd-name` | 9–10px | .09–.12em | uppercase muted | 141, 592, 1501 |
| Tabs | `.jsn-tab`, `.d-tab`, `.r-subtab` | 11–12px | .06–.09em | uppercase; active = ink + 2px red underline | 972–974, 264–265, 390–392 |

Rules of thumb:

- Display type always gets negative tracking. Uppercase micro labels always get positive tracking
  (.06–.13em) and `--muted`.
- Use `font-variant-numeric: tabular-nums` on every number that can change or sit in a column.
- Weights: 400 body, 500 labels / emphasis, 600 small display, 650 large display, 700 hero only.

---

## 4. Layout

### 4.1 The frame

```
┌ desk: warm radial gradient (body) ──────────────────────────────────────────┐
│ ┌──────┐  ┌───────────────────────────────────────────────────────────────┐ │
│ │ pill │  │ .main  floating content window                                │ │
│ │ side │  │ bg --off · radius 18 · 1px rgba(0,0,0,.06) · floating shadow  │ │
│ │ bar  │  │   .content > .view (one visible at a time)                    │ │
│ │ 72px │  │                                                               │ │
│ └──────┘  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
  10px gutters all round; .app padding: 10px 10px 10px 94px (1509)
```

**Sidebar `.sidebar`** (35, 1440, 1508, 1644):

- `position: fixed`, inset 10px top/left/bottom, width 72px. It expands to **216px on hover, over the
  content** (layout doesn't reflow), with a .28s `cubic-bezier(.16,1,.3,1)` transition.
- Radius 22px, frosted `rgba(248,246,240,.72)` with `backdrop-filter: blur(26px) saturate(1.7)`, hairline
  border, floating shadow.
- Nav item `.s-btn` (39–44, 1443–1446): 42px tall, radius 9, 18px Tabler icon, colour `#8E8E93`.
  - Hover: `rgba(0,0,0,.05)`.
  - Active `.on`: `rgba(0,0,0,.06)` fill, **red icon** and a **3px red rail** (`::before`, left -14px).
- Labels `.s-tip` fade and slide in after a .1s delay on hover (46–47).
- Appearance and Settings buttons sit at the bottom (`margin-top:auto`). The avatar `.s-avatar` is a red disc.

**Content window `.main`** (55, 1438): flex column, `overflow:hidden`. Each `.view` (70) is a flex column
that owns its own scroll container.

**No responsive breakpoints.** The only media queries are print and reduced-motion. This is a desktop
tool. Below about 1000px the To Do toolbar wraps awkwardly. Treat 1280px+ as the design width.

### 4.2 Page gutters and scroll containers

| Container | Padding | Line |
|---|---|---|
| `.dash-scroll`, `.boards-scroll` | 28px 28px 60px | 73, 425 |
| View header wrapper (inline style, see below) | 20px 28px 4px | 1757, 1832, 1851, 1875 |
| `.jobs-toolbar` | 14px 28px | 1103 |
| `.jobs-subnav` | 0 28px | 971 |
| `.report-scroll` | 32px | 354 |
| `.clients-wrap` | 28px 32px | 1020 |
| `.focus-wrap` | 30px 34px 70px | 1627 |
| `.act-feed` | 24px 28px 40px | 335 |
| Tables `td` | 14px 18px | 228 |

**Standard horizontal gutter: 28px.** Bottom padding of 40–60px on scroll areas, so the last card clears
the window edge and the toast area.

### 4.3 Spacing conventions

There's no spacing token, but the values follow a loose 2/4px scale:
**4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 24 · 28 · 32**.

- Between dashboard sections: `margin-top: 28px`. Section label to its content: 12–14px.
- Card grids: `gap: 12px` (KPI row, 80) or 16px (team grid 95, boards 451).
- Card padding: 20px 22px for KPIs, 18px for settings card bodies, 14px 16px for list rows and card heads.
- Inline gaps in toolbars: 8–10px. Icon to label: 5–9px.

### 4.4 View header pattern

Every top-level view starts with a title and a one-line sub:

```html
<div style="padding:20px 28px 4px;">
  <div class="view-title">Invoices</div>
  <div class="view-sub">Issued, paid &amp; still owing</div>
</div>
<div class="jobs-toolbar"> …search, filters, actions… </div>
```

- `.view-title` (76): 22px Inter Tight 650. `.view-sub` (77): 12px muted, .06em. The sub is a short,
  plain-English description ("Every job on the books", "Team week at a glance").
- The primary action for the view goes top-right, either in the sub-nav (`.d-action.primary`, e.g.
  "New job" at 1753) or right-aligned in the header row (Reporting 2015–2017).
- Dashboard swaps this for the hero: `.dash-greeting` + `.dash-date` + `.dash-rule` (4193–4195).
- Detail pages use `.detail-head` > `.detail-back` (pill "← back") > `.detail-title-row` > `.detail-tabs`
  (243–265).
- Sub-navigation tabs (`.jsn-tab`, 971–974) sit above the header on a white bar with a 2px border. Active
  tab = ink text + 2px red underline.

---

## 5. Components

### 5.1 Buttons

| Variant | Class | Spec (effective) | Lines |
|---|---|---|---|
| **Primary pill** | `.d-action.primary` | `--black` fill, white, 11px/500 uppercase .04em, padding 7px 18px, radius 980px, depth shadow; **hover = red glow**; active = `translateY(1px) scale(.985)` | 251–253, 1407, 1470, 1552, 1368 |
| Primary pill (toolbar) | `.tb-btn` | Same, 8px 18px, .05em | 64, 1407, 1470 |
| Primary pill (modal footer) | `.modal-ok`, `.modal-save` | `--ink` fill, white, **12px sentence case**, 7px 18px, pill; `:disabled` opacity .4 | 571–577, 1470 |
| Primary pill (todo modal) | `.tm-btn-save` | `--ink`, 13px, radius 20px, icon + label | 614 |
| **Secondary rect** | `.d-action` | Transparent, 1px `--border`, 11px/500 uppercase .04em, 7px 13px, `--r-ctl`; hover border → ink | 251–252, 1342 |
| Secondary (ghost toolbar) | `.tb-btn.ghost` | Transparent, border, `--r-ctl` | 66–67 |
| Secondary (modal) | `.modal-cancel`, `.cancel-b` | Transparent, border, muted text, 12px, `--r-ctl` | 569, 313 |
| Toolbar / filter | `.filter-btn`, `.p-btn`, `.wbtn` | White, border, uppercase 11px, `--r-ctl` | 220, 274, 130 |
| Segmented | `.todo-view-toggle` > `.tvt-btn`, `.inv-mode-bar` | Well in `--off`; active = white chip + small shadow | 1203–1205, 998–1000 |
| Back link | `.detail-back` | Pill, `--off` fill, 11px muted | 244 |
| Destructive | *(none, see §8)* | Currently inline `background:var(--red)` | 9246 |

Rules:

- **One primary pill per context.** Header and toolbar actions use uppercase micro labels. Modal footer
  actions use sentence case.
- In dark mode, primaries invert to `#F5F5F7` with `#141416` text (1583–1584).
- Every button gets `:focus-visible` = 2px red outline, offset 2px (245).

### 5.2 Inputs and selects

- **Global `select`** (1328–1330): no native chrome, warm chevron SVG, white, 1px `--border`, `--r-ctl`,
  padding 8px 30px 8px 11px, 13px. Hover border `#C9C3B8`. Focus border ink + `0 0 0 3px rgba(25,23,20,.07)`.
- **`.form-inp`** (1257–1259, 1331): the canonical text input. White, `--border`, `--r-ctl`, 8px 11px,
  13px, same focus ring.
- **`.field`** (561–567): stacked label + control in modals. Label is a 10px uppercase micro label. The
  control is filled `--off` and turns white on focus. `.field-row` puts fields side by side with 12px gaps.
- Text caret is **red** on every input (1414). Inputs suppress the outline in favour of the ring (246).
- Search field: `.jobs-search` (216–219), icon inset left.
- Pickers / combos: `.item-pick-dd` (1170, radius 10, `--shadow-m`), `.pick-search-wrap` (1172, sticky
  search row), `.combo-dd` (1252).
- Legacy `.cc-select` (978–980) is a second select spec. Prefer the global `select` (see §8).

### 5.3 Cards

All content cards share one recipe: `background:var(--white); border:1px solid var(--border);
border-radius:var(--r-card); box-shadow:var(--shadow-s)`, deepening to `--shadow-m` on hover.

| Card | Class | Notes | Lines |
|---|---|---|---|
| KPI | `.kpi` (in `.kpi-row`, 3 columns) | Padding 20px 22px. Label / value / sub / 4px progress bar (`.kpi-bar-fill` grows in with `ccFillIn`). Optional `.kpi-spark` | 80–87, 1363–1366, 1412, 1611 |
| Team | `.team-card` (in `.team-grid`, 2 columns) | `.tc-head` / `.tc-timeline` / `.tc-footer`. Lifts 2px on hover | 95–109, 1372–1373 |
| Settings | `.sett-card` > `.sett-card-hd` + `.sett-card-body` > `.sett-row` | Uppercase 11px/600 header. Rows with label/sub on the left, control on the right | 660–667 |
| Reporting KPI | `.r-kpi` | Same shell; number style differs (see §8) | 395–400 |
| Needs-attention | built by `_attCard()` | White card, 3px coloured left border, radius 12, icon tile, rows `.att-row`. **Entirely inline-styled** | 4167–4180 |
| Alert | `.alert` | 3px red left border, radius 10 | 111 |
| List card | `.my-todos` > `.my-todo-item` | Hairline rows (`--faint`), hover `--off`, round `.todo-check` | 114–121 |
| Board card | `.board-card`, `.bdet-card` | Radius 12, near-invisible border, `--shadow-s`. Columns are soft wells `rgba(0,0,0,.035)` radius 16 | 1513–1528 |

Clickable cards lift: `transform: translateY(-2px)` with a deeper shadow (1372–1373).

### 5.4 Status pills and badges

Base shape: inline-flex, padding 2–3px 8–9px, 10–11px, uppercase, .05–.06em, radius 20px, weight 500,
tint background + ink text, **no outline** (v2.31 intent, 1472).

| Family | Classes | Lines |
|---|---|---|
| Job status | `.status-pill` + `.sp-ip` (ok), `.sp-new` (danger), `.sp-co` (neutral) | 238–239 |
| Workflow | `.wf-badge` + `.wf-quote / .wf-live / .wf-completed / .wf-invoiced` | 984–988 |
| Invoice | `.inv-pill` + `.draft / .sent / .paid / .approved / .overdue / .voided` | 787–791, 1006–1007 |
| Expense | `.exp-badg` + `.draft / .approved / .invoiced` | 323–326 |
| Item | `.i-badge` + `.ib-c / .ib-p` | 302–303 |
| Time | `.t-bill`, `.t-nobill` | 733–734 |
| Paused / editable | `.paused-badge` (hover border → ink when clickable) | 989–991 |
| Neutral chip | `.sett-chip`, `.label-chip`, `.bc-lbl` | 1242, 258, 1065 |

Dark-mode tints for each family are listed individually at 1597–1601. For a new pill, build it on the
`--ok/--warn/--info/--danger` tokens so it needs no dark override.

### 5.5 Tables

Canonical: **`.jobs-table`** (224–228).

- Header `th`: white, sticky, 10px/500 uppercase .13em muted, padding 12px 18px, 1px bottom border.
- Rows: 1px `--faint` divider, pointer cursor, hover `#FAF8F3` (1646).
- Cells: padding 14px 18px, vertical middle, tabular-nums.
- Typical first cell: `.job-num` (11px muted) + `.job-name` (14px) + `.job-co` (12px muted).
- Bars inside cells: `.bbar-track` 4px rounded (1408) with `.bfok/.bfwarn/.bfbad` fills.
- Column show/hide is done with container classes (`.hc-*`, 1487–1489), not re-rendering.
- Similar variants: `.r-table` (374–379), `.prog-table` (1272–1279), `.time-table` (727–731),
  `.inv-table` (1001–1005), `.items-t` (291–297). Totals rows: 2px top border, weight 500.

### 5.6 Modals

- **Backdrop `.modal-bg`** (552, 1465): `rgba(28,28,30,.30)` + `backdrop-filter: blur(16px) saturate(1.5)`.
  It dims lightly and blurs heavily. Toggle with `.on`. Clicking the backdrop closes it.
- **Panel `.modal`** (555, 1468): `--white`, radius **18px**, `--shadow-l`, width 600px (narrower ones set
  `max-width` inline: 380–560px).
- **Light header `.modal-hd`** (1450–1453): white, padding 18px 24px 14px, 1px `--faint` bottom border,
  `.modal-hd-title` 16px Inter Tight 600, `.modal-x` muted close icon. (The original dark ink header at
  556 is superseded. Don't revive it.)
- **Body `.modal-bd`**: padding 22px 24px. **Footer `.modal-ft`**: 14px 24px, top border, right-aligned,
  gap 8. Secondary (`.modal-cancel`) first, then primary pill (`.modal-save` / `.modal-ok`).
- **Entrance:** `ccModalIn` .22s `cubic-bezier(.16,1,.3,1)`, rising 10px from scale .98 (1359–1361).
- Confirm dialogs: use `ccConfirm(msg, onYes, yesLabel, danger)` (9239) instead of `window.confirm`.
- Other overlay shells that share the backdrop: `.gs-panel` (Cmd+K search, 640px, radius 18, 1293/1385),
  `.tm-modal` (task), `.cl-modal` (changelog), `.inv-modal`, `.cb-modal` (create board, keeps a dark left
  panel, 465). Side drawers: `.detail-drawer` / `.tm-detail-panel` slide in from the right in .22s (756, 679).

### 5.7 Toasts

- Call `toast(msg, type='info'|'success'|'warn'|'error', duration=3200)` (9229). It builds `.cc-toast`
  with a Tabler icon.
- `.cc-toast` (1224–1228, 1419–1420): fixed bottom-right 28px, ink background, white 12px, radius 9,
  padding 11px 16px, icon + text in a flex row, slides up 12px and fades in over .22s.
- Variants: `.toast-success` `#2E7D32`, `.toast-error` `--red`, `.toast-warn` `#E65100`.
- Undo links go inside the message with `.toast-undo` (1016).
- Keep copy short and human ("Wallpaper set — hello, glass", "Handed to Josie").

### 5.8 Empty states

- Call `emptyStateHTML(icon, title, sub, ctaLabel?, ctaOnclick?)` (2717). CSS at 1308–1312.
- Layout: centred column, 64px vertical padding. A 56px round `--off` icon well with a 24px muted Tabler
  icon, then `.es-title` (16px Inter Tight 600), then `.es-sub` (12.5px muted, max 320px, lh 1.5), then an
  optional `.d-action.primary` CTA.
- Example: Jobs (6922), Clients (9708), Boards (12483).
- The sub line explains *what the thing is for*, not just "nothing here".

### 5.9 Skeleton loaders

- `.skel` (1403–1404): inline-block, 12px tall, radius 6. Shimmer gradient
  `--faint → #F3F0E9 → --faint`, animated by `ccShimmer` (1.3s ease-in-out, infinite).
- Size each bar with an inline `width:%` to suggest the real content shape. Example: the jobs table
  skeleton row (3710), with a pill-shaped skel (`height:18px; border-radius:10px`) for the status column.

### 5.10 The drop dock (signature interaction)

While the user drags something, a frosted strip of drop destinations **docks at the bottom centre of the
screen**. The client likes this interaction a lot. Reuse it for any new drag flow rather than inventing a
different one.

**CSS:**

- `.sched-strip` (1497–1498): fixed, `bottom:24px`, centred.
  - `rgba(255,255,255,.85)` + `blur(22px) saturate(1.6)`, hairline border, radius 16, `--shadow-l`,
    padding 12px 14px, gap 8.
  - Hidden state is `opacity:0` + `translateY(16px)`. Adding `.on` fades it in (.18s) and springs it up
    (.22s `cubic-bezier(.16,1,.3,1)`).
- `.ss-lbl` (1499): uppercase 11px/600 muted lead-in ("Drop to", "Hand to", "Schedule for Ronan").
- `.ss-day` (1500–1503): 74px tile with a 1.5px **dashed** border, radius 11, white. Holds `.ssd-name`
  (9px uppercase) and `.ssd-num` (17px/600). `.ssd-today` makes the number red. `.ss-week` (1536) is the
  wide "← Last week / Next week →" variant.
- `.ss-person` (1532–1535): 48px avatar target (28px disc + 8.5px name).
- `.ss-sep` (1538): 1px × 34px divider between groups.
- **Hover-over state `.drop-ok`** (1504, 1535): border goes solid **red**, tint `#FFF5F5`, scale 1.06–1.08.

**Split zones** `.split-zone` (1541–1544) are a companion pattern. Thin dashed red seams appear between
day columns while a task is dragged. Dropping on one halves the task across both days. The label is set
vertically (`writing-mode: vertical-rl`).

**JS** (all built on drag start, removed on drop or dragend):

| Function | Line | Dock for |
|---|---|---|
| `_showSchedStrip(item)` | 7724 | Job-plan item → day this week |
| `_showTaskDock(t, day)` | 7763 | To Do card → last/next week or a teammate |
| `_showClientDock(name)` | 7807 | Client card → spawn the client's board |
| `_showInvDock(jobId)` | 7828 | Uninvoiced job → draft invoice |
| `_showSplitZones(t, day)` | 7845 | Seams between day columns |

Tiles use inline `ondragover` (add `.drop-ok`), `ondragleave` (remove it) and `ondrop`. The element is
appended to `body`, and `.on` is added on the next animation frame.

### 5.11 To Do board task cards (**sacred: document, don't redesign**)

The client treats the To Do board's **proportional-height task cards and their resize behaviour as
sacred**. Card height *is* the time estimate. Keep this behaviour exactly as it is. Any visual refresh has
to work within it.

**Look** (189–210, 1380–1382):

- `.task-card`: white, 1px border, **radius 8px**, padding 8px 10px, min-height 52px, `--shadow-s`
  (`--shadow-m` on hover).
- Status is shown **only** by a 3px left border: `.tc-bill` green, `.tc-nonbill` orange, `.tc-urgent` red.
- Done: `.done-c` (green `--done` fill, title struck through and muted).
- Contents:
  - `.tc-top`: Lucide item icon + `.tc-title` 13px + `.tc-hrs` chip
  - `.tc-meta`: job · item, 11px muted
  - `.tc-note`: italic
- Overflowing text **fades out**. `::after` is a 14px gradient to `--card-bg` (1380–1382), so clipping
  reads as intentional. `--card-bg` follows the done state.

**Height** (`taskCardHeight`, 5422–5428):

```
px per hour = max(16, todoSplitPx / 8)       // todoSplitPx = to-do zone height = an 8h day
height      = max(52, round(hours × px per hour))
```

`todoSplitPx` is set by dragging the **global done divider** (`.global-divider`, 173, 1648; logic at 4727,
6562). That bar splits every day column into a to-do zone above and a done zone below. Moving it rescales
every card.

**Resize** (5493–5545):

- Hovering within 7px of a card's top or bottom edge shows an `ns-resize` cursor. Dragging changes the
  task's hours live.
- Hours snap to 5 minutes, with a floor of 5 minutes and a ceiling of 8 hours.
- During the drag the 52px readability floor is relaxed to 26px. Content then hides progressively:
  - Under 44px: the icon and hours go
  - Under 68px: the meta line goes
  - Under 95px: the note goes
- On release the day header, the week summary and job stats re-render.

Other board pieces:

- Day headers: `.day-head`, with today marked by a 3px red inset top line (138).
- Capacity bar: `.day-cap` (178–185).
- Zone buckets: `.zone-bucket`, collapsed summaries (160–168).
- Overflow pills (155–157).
- Focus mode (`.focus-*`, 1624–1636) deliberately drops proportional cards for a calm list.

---

## 6. Motion

| Name | Definition | Duration / easing | Used for | Lines |
|---|---|---|---|---|
| `viewIn` | opacity 0→1, translateY 6px→0 | .24s ease (KPI cards .3s, staggered 0/.05/.1s) | Every `.view` on show; KPI cards | 808–809, 1364–1366 |
| `ccModalIn` | opacity, translateY 10px, scale .98→1 | .22s `cubic-bezier(.16,1,.3,1)` | All modals, search, invoice, create-board | 1359–1361 |
| `ccFillIn` | scaleX 0→1 from left | .8s `cubic-bezier(.22,1,.36,1)` | KPI and reporting progress bars | 1362–1363 |
| `ccShimmer` | background-position sweep | 1.3s ease-in-out infinite | `.skel` | 1403–1404 |
| `ccSplashIn` | opacity, scale .92, translateY 8px | .55s `cubic-bezier(.16,1,.3,1)`; splash fades out .45s | Launch logo | 1618–1622 |
| `ccspin` | rotate 360° | 1s linear infinite | `.ti-loader` spinner | 92–93 |

**Transitions:**

- Hover colour and border: .1–.15s.
- Card shadow and lift: .18s (`translateY(-2px)`, 1373).
- Press: `translateY(1px) scale(.985)` (1368–1370).
- Sidebar expand: .28s `cubic-bezier(.16,1,.3,1)`; labels fade in .18s after a .1s delay.
- Drawers: .22s `cubic-bezier(.4,0,.2,1)`.
- Drop dock: .18s opacity / .22s spring. Dock tile scale on `.drop-ok`: .12s.
- Toast: .22s ease.
- Day-zone glide: `.animating` .26s (153–154), only when a bucket button triggers it, never during a live drag.

**Reduced motion** (1375). Keep this rule global:

```css
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important;}}
```

When you add motion, use CSS animations or transitions so this rule covers it. JS-driven animation
(rAF tweens, Web Animations API) has to check `matchMedia('(prefers-reduced-motion: reduce)')` itself.

---

## 7. Dark mode and wallpaper / glass mode

### 7.1 Dark mode: `body.dark`

- **Toggle:** `toggleTheme()` (2588) flips `document.body.classList` `dark` and persists
  `localStorage.cc_theme`. It's applied before first paint by an IIFE (2586). The icon syncs via
  `_syncThemeIcon()`. Charts re-theme through `_applyChartTheme()` (11979).
- **Tokens that change** (1563–1574):
  - Surfaces: `--off`, `--white`, `--faint`, `--border`
  - Text: `--ink`, `--muted`
  - Status: `--done*`, `--ok*`, `--warn-ink/-bg`, `--info*`, `--danger*`
  - All three shadows
  - The desk gradient
- **Unchanged:** `--red`, `--black`, `--warn`, fonts, radii.
- **Component overrides** (1575–1607):
  - Sidebar glass `rgba(22,22,24,.7)`
  - Primaries invert to light pills
  - Toasts and tooltips `#2E2E33`
  - Dock glass `rgba(36,36,40,.85)`
  - Zone buckets and per-family pill tints
  - Scrollbars and selection
- **Documents stay paper-white on purpose** (invoice / quote previews, 7910, 8270).
- Print forces light tokens (1609).

**How to stay dark-safe:**

- Never hardcode `#fff`, `white` or a light tint as a surface. Use `var(--white)` / `var(--off)`.
- Remember that `--ink` flips to near-white. **Never pair `background:var(--ink)` with `color:#fff`.**
  Use `color:var(--white)` (which flips to dark) or add a `body.dark` override (see §8, item 1).
- Prefer status tokens for tints so no per-class dark override is needed.

### 7.2 Wallpaper / liquid-glass mode: `body.has-bg`

- **Set:** Settings → Appearance → `setBgImage(file)` (2607). The image is downscaled to ≤1920px and
  stored as JPEG in `localStorage.cc_bg_image`. `applyBgImage()` (2601) toggles `has-bg` and sets
  `body.style.backgroundImage`. `clearBgImage()` removes it.
- **Effect** (1657–1663):
  - The wallpaper covers the desk, fixed.
  - `.main` becomes deep frosted glass `rgba(246,243,235,.58)` + `blur(34px) saturate(1.55)`. In dark mode
    it's `rgba(18,18,20,.55)`.
  - The sidebar gets more transparent (`.42`; dark `.4`).
  - The splash goes translucent.
- **Cards stay solid** (`--white`) for legibility. Only the frame turns to glass. No tokens change.
  New screens get glass for free as long as they sit on `.main` and use `--white` cards.

---

## 8. Inconsistencies to clean up

Ordered by visible impact. Every item has been checked against the code. Items marked **(verified in
browser)** were confirmed by measuring computed styles in the running app.

### High impact (user-visible bugs or brand drift)

1. **Dark mode: white text on near-white buttons (verified in browser).** These rules pair
   `background:var(--ink)` with a literal `color:#fff`. In dark mode `--ink` becomes `#F2F2F4`, so the
   text disappears:
   - `.todo-ov-btn` (157)
   - `.cb-modal-left`, the whole create-board side panel (465)
   - `.fup-y` (801)
   - `.cal-pop-day.cal-today` (849, 852)
   - `.wf-stage-btn.on` (1137)
   - `.cal-filter-chip.on` (1144)
   - `.rep-end-chip.on` (1208)
   - `.mc-day.mc-sel` (1220)
   - `#focus-btn.on` (1636)
   - Inline: the bulk-action bar (1782), the board type badge (2079), Settings dashboard toggles (10047, 10060)

   Fix: use `color:var(--white)`, or one shared "selected chip" class with a dark override.
2. **The drop dock is unreadable in dark mode (verified in browser).** `.ss-day.drop-ok` and
   `.ss-person.drop-ok` hardcode `background:#FFF5F5` (1504, 1535) with no dark override. The highlighted
   target turns bright pink with near-white `#F2F2F4` text, at exactly the moment the user needs to read it.
   Use `rgba(237,30,36,.12)` like `.split-zone.drop-ok` (1543).
3. **Toasts lose their status colour in dark mode (verified in browser).** `body.dark .cc-toast` (1586,
   specificity 0,2,1) beats `.cc-toast.toast-success/.toast-error/.toast-warn` (1226–1228, 0,2,0). Every
   dark toast is grey and only the icon differs. Scope it as `body.dark .cc-toast:not([class*=toast-])` or
   add dark variants.
4. **Cool "Apple" leftovers from v2.31 that v2.38 didn't re-warm.** These are still live in light mode and
   go against the beige brief:
   - Shadows use neutral `rgba(0,0,0,…)` (1431–1433, 1438, 1508). The warm originals were
     `rgba(35,28,18,…)` (20–22).
   - `.day-todo.drop-hi{background:#F4F8FF}`, a blue tint on the To Do drop target (1478; the original was
     warm `#fffdf5` at 158).
   - `.done-overflow-pill` `rgba(245,247,250,.97)` (156).
   - `.dcb-nbill-todo` slate `#CBD5E1` (181).
   - `.ib-p` indigo `#EEF2FF/#3730A3` (303).
   - The chart theme uses `#86868B` labels and a `rgba(29,29,31,.94)` tooltip (11986–11988).
   - `.s-btn` colour `#8E8E93` (1443).
   - The modal backdrop tint `rgba(28,28,30,.30)` (1465).
5. **The light-mode Streamtime warning banner uses dark-mode colours.** `#st-data-warn` (1694) is inline
   `background:#2a1a0e; border:#7c4a1e; color:#e8a46a`, a dark-brown slab on beige paper. Rebuild it on
   `--warn-bg / --warn-ink`.
6. **Pill outlines were meant to be removed but survive.** v2.31 sets `.inv-pill{border:none}` (1472),
   but `.inv-pill.draft/.sent/.paid/.approved/.overdue/.voided` (788–791, 1006–1007) have higher
   specificity. Invoice pills still render 1px coloured outlines (verified in browser), while `.wf-badge`
   and `.exp-badg` don't.

### Tokens bypassed in JS and markup

7. **Hardcoded colours everywhere outside the stylesheet.** There are about **1,510 inline `style=`
   attributes** and **270 six-digit hex literals** in the markup and JS. The worst repeats:
   - `#4CAF50` ×37 instead of `var(--ok)`, e.g. KPI bars 4198–4200, phase icons 8468, charts 12100–12118
   - `#FF9800` ×12 instead of `var(--warn)`
   - `#ED1E24` ×18 instead of `var(--red)`, e.g. 7918, 8140
   - `#E65100` ×13
8. **The person/label colour palette is redefined 7+ times with different contents:**
   - `LABEL_COLORS` (2707)
   - `COLS` (3730)
   - `colors` (6274)
   - `COLORS` (9974, 10305, 10472)
   - `palette` (12198)
   - `splitPalette` (12095)

   Make it one exported constant, ideally `--cat-1…--cat-10` tokens.
9. **The needs-attention card is fully inline** (`_attCard`, 4173–4180): radius 12, padding, border and
   shadow are all literals. Its icon tile uses `color-mix(in srgb, ${color} 11%, white)`, which mixes with
   **white** in dark mode too and shows pale tiles on a dark card. It should be a `.att-card` class with
   `--white` in the mix.
10. **Light-only tints with no dark override:**
    - `.cal-week-day.today` / `.cal-month-day.today` `#fff9f9` (900, 921)
    - `.item-pick-opt.selected` `#FFF0EE` (1180)
    - `.tcm-item.danger:hover` `#FFF5F5` (1234)
    - `.day-col.drop-highlight` `#FFF8E1` (960)
    - Calendar event priority/person colours (906–913)
    - `.tc-block.urgent` (106)
    - `.paused-warn` (996)
    - Happiness face selection `#FFF3C4` (4252)
    - `#create-item-menu` `background:#fff` (1960)
    - The quote-editor side panel `#fff` (8330)
11. **Dark-mode attribute hack:** `body.dark .grp-hd[style*="fffbea"]` (1604) overrides an inline style by
    matching its text. This breaks as soon as anyone edits that inline colour. Move the colour into a class.
12. **The print reset uses the old v1 palette.** `@media print{body.dark{--ink:#191714;--off:#F6F4EF;…}}`
    (1609) doesn't match the current light tokens (1641).

### Radii, buttons and duplicated specs

13. **Radii bypass the tokens.** v2.29 hardcoded 6/9/10/12/14px (1347–1355). Then v2.31 raised `--r-card`
    to 16 and modals to 18, which left a spread of 8/10/12/16/18 for similar surfaces:
    - Task card 8 (189)
    - Menus 10 (1348)
    - Board cards 12 (1518)
    - Column picker 12 (1490)
    - Dock 16 (1497)

    Inline JS radii: `4px` ×22, `3px` ×20, `2px` ×18, the last of these are pre-v2.29 values. Suggest
    adding `--r-sm:6px; --r-menu:12px; --r-modal:18px; --r-pill:980px`.
14. **Two near-black primaries.** `.d-action.primary`, `.tb-btn` and `.r-export-btn` use `--black #0D0D0D`
    (64, 253, 416). `.modal-ok`, `.modal-save`, `.save-b`, `.tm-btn-save`, `.cb-create-btn` and
    `.cal-today-btn` use `--ink #1D1C19` (571, 575, 311, 614, 483, 888). Pick one (`--ink` keeps it warmer).
15. **No destructive button style.** `ccConfirm` sets `class="modal-save danger"` but there's no `.danger`
    rule, so the red is applied inline (9246). Add `.modal-save.danger` / `.d-action.danger`.
16. **Three select specs:**
    - `.cc-select` (978–980): radius 3px, cool `#999` chevron, `#bbb` hover, 2px ring
    - The global `select` (1328–1330): `--r-ctl`, warm chevron, 3px ring
    - `select.filter-btn` (982)

    `.cc-select` is still used 23 times. Retire it in favour of the global rule.
    `.form-inp:focus` is also defined twice with different rings (1258 vs 1331).
17. **Class-name collisions (different components, same class).** Both rules apply to both components:
    - `.tc-meta` is the team-card meta (101) *and* the task-card meta (205). The team card head inherits
      `padding-left:22px; display:flex; margin-top:4px` (verified in browser).
    - `.tm-meta` is the task-modal meta (607) *and* the team-member card meta (677). The later rule forces
      `display:flex; font-size:10px` onto the task-modal timestamp (2405).
    - The `tm-` prefix is shared by the **t**ask **m**odal (`.tm-modal`, `.tm-hd`…) and **t**eam
      **m**embers (`.tm-card`, `.tm-av`, `.tm-detail-panel`…).
18. **Duplicate or dead rules to delete:**
    - The red full stop is added (1548) then cancelled (1653). Remove both.
    - Duplicates:
      - `.task-card:hover` (190, 191)
      - `.todo-body` (134, 149)
      - `.add-e-row:hover` (328, 330)
      - `.tm-hd-personal` (582, 1107)
      - `.gs-panel` (1293, 1385, 1466)
      - `.cc-toast` (1224, 1419)
      - Splash background (1618, 1651)
    - `:root` is defined four times (15, 1428, 1616, 1640). Fold these into one block.
    - Unused (no references outside the stylesheet; verify before deleting):
      - `.topbar` / `.tb-section` (58–62)
      - `.changelog` (812–813)
      - `.r-card` (359–362)
      - `.r-p-card` and its children (380–386)
      - `.cal-week-*` / `.cal-month-*` grid (894–927)
    - Stale comment at 75: says the greeting is a "36px hero", but it's 31px (1482).

### Typography, structure and other

19. **Two number styles.** The dashboard `.kpi-val` is Inter Tight 28/650 (84). Reporting `.r-kpi-val`
    (397), `.r-p-hours` (383) and `.r-person-card-hours` (408) are plain Inter 22–26/500. `.day-num` asks
    for weight 650 on Inter (1554), which renders as 700 because only static weights are loaded.
20. **No view-header class.** The header wrapper is repeated inline as `padding:20px 28px 4px` (1757,
    1832, 1851, 1875), with variants at 1902 (`…0`) and 1925 (`24px 28px 40px`). Gutters also drift
    between 24, 28, 32 and 34px (354, 1020, 1627). Introduce `.view-head`.
21. **Ad-hoc empty states** bypass `emptyStateHTML()`: 8017, 8433, 9813, 12821 (inline muted text).
22. **Icon libraries.** Tabler is loaded from `@latest` (line 8, unpinned, so the CDN can change icons
    under you). Lucide is loaded as a second library for a single call site (task-card icons, 5441).
    Pin Tabler and consider mapping task icons to Tabler.
23. **z-index has no scale.** There are 25 distinct values from 1 to 99999. Context menus `.ctx/.pctx`
    (500, line 542) sit *below* the sidebar (600), so a menu opened near the left edge can slide under the
    expanded rail.
24. **Behaviour note (do not "fix" without client sign-off).** Card *render* height uses
    `max(16, todoSplitPx/8)` px/hour (5426). The *resize* maths uses `max(24, todoSplitPx/8)` (5521).
    When the to-do zone is shorter than 192px, a card jumps size on release. Flag it to the client before
    touching it (§5.11).

---

## 9. How to add a new screen: checklist

**Structure**

- [ ] Add a nav button to `.s-nav` (line 1671+) as
      `<div class="s-btn" id="snav-x" onclick="navTo('x')"><i class="ti ti-…"></i><span class="s-tip">Label</span></div>`.
      Use a Tabler icon. Active state is handled by `.on`.
- [ ] Add `<div id="view-x" class="view hidden">` inside `.content`. It gets the `viewIn` entrance
      automatically.
- [ ] Give it one scroll container with the standard gutter: `padding: 28px 28px 60px` (copy
      `.dash-scroll`). Don't let `.view` itself scroll.
- [ ] Start with the header pattern: `.view-title` (22px Inter Tight) + `.view-sub` (one plain-English
      line). One primary action top-right as `.d-action.primary`.

**Styling**

- [ ] Use tokens only: `--white` for card surfaces, `--off` for wells and hovers, `--ink` / `--muted` for
      text, `--border` / `--faint` for lines, `--ok/--warn/--info/--danger` for status. **No hex literals,
      no `#fff`.**
- [ ] Cards: `--white` + 1px `--border` + `--r-card` + `--shadow-s` → `--shadow-m` on hover. Controls:
      `--r-ctl`. Primary buttons: pill.
- [ ] Group content under `.section-label` headings (uppercase micro + hairline) with 28px between sections.
- [ ] Use existing classes before writing new ones: `.form-inp`, global `select`, `.field`, `.jobs-table`,
      `.status-pill` / `.wf-badge`, `.sett-card`, `.kpi`, `.modal*`. Put new CSS in **one** clearly
      labelled block at the end of the stylesheet. Don't edit the older layers in place, and keep inline
      `style=` to dynamic values only (widths, data-driven colours).
- [ ] Prefix new class names uniquely (check that `grep -c "\.yourprefix-"` returns 0 first). See the
      collisions in §8 item 17.

**Behaviour**

- [ ] Feedback: `toast()` for results, `ccConfirm()` for destructive confirmation, `emptyStateHTML()` for
      zero data, `.skel` rows while loading.
- [ ] Drag-and-drop: reuse the drop dock (`.sched-strip` + `.ss-day` / `.ss-person`, §5.10). Don't build a
      new drop UI.
- [ ] Red is for active, today, urgent and focus only. Check the screen against Principle 3.
- [ ] Numbers use `font-variant-numeric: tabular-nums`. Big numbers use `var(--display)`.
- [ ] Motion: CSS only, ≤ .3s, existing keyframes (`viewIn`, `ccModalIn`, `ccFillIn`).

**Verify before shipping**

- [ ] Light mode looks warm (no grey-blue anywhere).
- [ ] **Dark mode:** toggle via the moon icon. Check every selected or active chip for contrast, and look
      for any surface that stayed white.
- [ ] **Wallpaper mode:** set an image in Settings → Appearance. The window should frost and your cards
      should stay solid and readable.
- [ ] Reduced motion: emulate `prefers-reduced-motion: reduce` and confirm nothing depends on an animation
      finishing.
- [ ] Keyboard: every control is reachable and shows the red `:focus-visible` ring.
- [ ] At 1280px width nothing wraps or overflows horizontally.
- [ ] If the screen touches the To Do board: card heights, the edge-resize and the done divider behave
      exactly as before (§5.11).
