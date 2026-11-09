# DESIGN-V4 — "Tidewell glass"

V4 reskins Escheat Agent after the reference in `docs/design/reference-tidewell.png`, the "Tidewell" hotel hero in the
lower half of the image. It keeps that hero's palette and its composition:

- a deep navy field with a coral bloom and a steel haze, under fluted (ribbed) glass;
- a floating pill nav;
- round glass buttons;
- stacked glass booking cards;
- a huge, light, tight-tracked cream headline;
- a coral pill CTA next to a ghost ↗ link;
- a five-column feature strip on a hairline.

V4 replaces DESIGN-V3's black, electric blue and pink. The V3 rules still hold where this file says nothing.

**Palette rule:** navy + cream + coral, plus steel blue for info and data. Coral means a human must act. No green.

## 1. Tokens: old name → new meaning

The token **names** did not change, because hundreds of components use them. Their **values and meanings** did. All of
them are in `src/app/globals.css` under `@theme static`.

| Token | V3 meaning | V4 value | V4 meaning |
|---|---|---|---|
| `ink-0` | page black | `#0B1430` | deepest navy, page base |
| `ink-1` | sunken | `#101B3A` | rails, wells |
| `ink-2` | card | `#14213D` | cards and panels (the Navy swatch) |
| `ink-3` | raised | `#1C2B4D` | hover, selected, popovers |
| `ink-4` | highest | `#26375C` | tracks, highest raised step |
| `fg-1` | white text | `#F4EDE0` | primary text (the Cream swatch) |
| `fg-2` | secondary | `#D2CDC4` | secondary text, cream mixed toward navy |
| `fg-3` | tertiary | `#A6ACBE` | labels and tertiary text, cool cream-grey |
| `fg-4` | decoration | `#5B6683` | rules and ticks only, never text |
| `line`, `line-hover`, `line-strong` | white hairlines | cream at 9%, 15%, 24% | hairlines |
| `pink-300…950` | pink: human must act | **coral** `#FFB8AE` `#FF8E80` **`#FF6B5B`** `#E8503F` `#A23A33` `#3B2333` `#261A2C` | coral: approve, overdue, needs you, and the primary CTA |
| `blue-200…950` | electric blue: system | **steel** `#DCE6F7` `#BDCEEE` **`#9DB4E0`** `#7F9AD0` `#4A66A3` `#3B528A` `#2C3F6B` `#1F2E52` `#172440` | steel: data, info, links, focus rings, "the system did it" |
| Tailwind `black` | `#000` | `#060B1F` | navy-black, so `text-black` on coral and `bg-black/50` scrims stay in palette |
| `--primary` (shadcn) | blue-600 / white | coral-500 / ink-0 | the primary button |

### Contrast (WCAG AA, measured)

| Text | ink-0 | ink-2 | ink-4 | glass over the bloom |
|---|---|---|---|---|
| `fg-1` | 15.6 | 13.7 | 10.1 | 11.5 |
| `fg-2` | 11.4 | 10.0 | 7.4 | 8.4 |
| `fg-3` | 8.0 | 7.1 | 5.2 | 5.9 |
| `pink-400` (coral text) | 8.2 | 7.2 | 5.3 | 6.0 |
| `blue-400` (steel text) | 8.7 | 7.6 | 5.6 | 6.4 |

On fills:

- navy on coral-500: 6.5
- cream on coral: 2.4. **Never use it.** Coral fills take navy text.
- cream on blue-600: 4.85, so blue-600 and blue-700 are **fill only**.

### Rules

- Coral means a person acts:
  - approve buttons;
  - overdue items;
  - the Needs-you count and the approvals badge;
  - the active dot in the pill nav;
  - the first item in the feature strip;
  - the primary CTA.
- Steel means the system:
  - data series;
  - info banners;
  - links and focus rings;
  - "done" and verified marks;
  - the navigation progress hairline.
- Charts use steel tints for data. Coral marks attention only.
- PDFs and letters keep a light print palette (white paper). Their accents are navy `#14213D` and coral. Coral used as
  text on white is the darker `#C4402F` (5.1:1).
- Replica portals (`/replica/*`) keep their own dated government look and banner. The backdrop and grain are hidden there.

## 2. Glass, ribbed glass and the backdrop

### Backdrop

`.es-backdrop` is rendered by `components/shell/Backdrop.tsx` in the root layout, behind every page. It is `fixed`
with `z-index: -1`, `aria-hidden`, and `pointer-events: none`. The `<body>` is transparent (the `<html>` keeps `ink-0`),
otherwise the body's own background would paint over a negative-z layer. It is built only from CSS gradients:

1. a hot coral core behind the headline: `radial-gradient(16% 26% at 50% 66%, #FF9684/0.42 → transparent)`;
2. the big saturated coral bloom, a tall ellipse low and centre: `radial-gradient(44% 60% at 52% 64%, coral/0.74 → 0.46 →
   0.18 → transparent)`;
3. a coral floor wash along the bottom edge;
4. a steel haze at the top left: `radial-gradient(34% 52% at 14% 22%, #9DB4E0/0.5 → 0.2 → transparent)`;
5. a steel lift on the right;
6. a darker edge vignette, `rgb(4 8 24 / 0.72)` at 100%;
7. a navy base, `#18274F` at the top to `ink-0` at 85%.

The `<html>` canvas also carries a rib pass and a navy gradient, so a full-page capture (or overscroll) past the fixed
backdrop still shows the fluting. Replica portals and reduced transparency reset it to plain `ink-0`.

The glow peaks around y 66% of the viewport, behind the headline. The copy and the strip under it sit on its shoulder.
Measured on the 1440 screenshot against the brightest rib-highlight pixel next to each line: the muted sentence (fg-2)
≥ 4.5:1, the strip (fg-2) ≈ 6.8:1, the coral first strip item ≈ 9:1, the cream ghost link ≈ 12.9:1. The headline is
large text (≥ 3:1 needed) and is cream.

### Ribbed glass

`.es-ribbed` sits inside the backdrop, so it is **under** content and can never lower text contrast. It is a
`repeating-linear-gradient(90deg …)` with a 5px pitch:

- a 1px cream highlight at 10% opacity;
- a soft fall-off;
- a navy groove at 17–30% opacity between 3.25 and 4.4px.

It covers the **whole page** at every width (it is part of the fixed backdrop, not of any card). A second pass at 20px
pitch (`::after`) adds the slight refraction wobble without an SVG filter. A mask keeps the ribs at 70% at the top and
full strength from the middle down, where the glow is. There is no canvas and no animation.

### Stage

`.es-stage` (the dashboard hero) has **no box**: no background, border, radius or shadow. It sits straight on the page
backdrop and only sets a stacking context. Its glow and ribs are the page's.

### Glass utilities

| Utility | Fill | Border | Shadow | Blur | Use |
|---|---|---|---|---|---|
| `glass` | `rgb(20 33 61 / .62)` | cream 11% | `--shadow-glass` (inset top highlight + soft navy drop) | 18px, saturate 1.25 | cards, panels, Loop Bar |
| `glass-strong` | `rgb(16 27 58 / .86)` | cream 11% | `--shadow-float` | 24px | top bar, anything over moving content |
| `glass-pill` | cream 6% | cream 11% | inset top highlight | 12px | chips, round buttons, the pill nav capsule; `border-radius: 9999px` |
| `elev-1/2/3` | redefined as glass | | | | |

Floating layers (popover, dropdown, select, dialog, sheet) are `ink-*/92` with `backdrop-blur-xl`, radius 14px for menus
and 22px for dialogs.

### Reduced transparency and print

- Under `prefers-reduced-transparency`:
  - the glass tokens become opaque `ink-2`;
  - `backdrop-filter` is removed;
  - the ribs and the grain are hidden.
- Under `prefers-reduced-motion` nothing in the atmosphere moves, because nothing in it ever animates.
- In print the backdrop, the ribs and the grain are hidden.

## 3. Type scale (Geist, no new fonts)

| Role | Spec |
|---|---|
| Stage headline (dashboard) | `type-display`, `clamp(2.9rem, 0.6rem + 6.4vw, 6.4rem)`, weight 300, tracking −0.05em, leading 0.96, two lines, cream |
| Page title (`PageHeader` h1) | `type-display`, `clamp(2rem, 1.45rem + 1.9vw, 3.25rem)`, weight 300, tracking −0.035em |
| Big numerals (`KpiStat`) | weight 300; hero `clamp(3rem, 1.6rem + 4.4vw, 5.5rem)` at −0.045em, lg 32px, md 22px |
| Booking numerals (deadline rows) | 26px, weight 300, −0.03em |
| Small label | `type-label`: 12/16, weight 400, `fg-3`, sentence case, like "Check-in" over "Fri 14" |
| Body | 15/24 `fg-2` under headlines; 13–14px in dense UI |
| Instrument label | unchanged mono 11px uppercase, for eyebrows and axes only |

## 4. Buttons and pills

All of these are in `components/ui/button.tsx` (`PRIMARY`, `SECONDARY`) and `components/shell/chrome.ts`.

| Kind | Spec |
|---|---|
| Primary | coral-500 pill with navy text (6.5:1), medium weight, coral drop glow, inset white highlight. Hover coral-400, active coral-600. Optional ↗ (`ArrowUpRight`) for navigational CTAs. `ActionButton` approve and primary use the same classes. |
| Secondary (`outline`, `secondary`) | glass pill: cream 6% fill, `line-hover` border, blur. Hover cream 10%. |
| Ghost | `ghost` variant (cream 7% on hover), or a text link in `fg-1` with ↗ and an underline on hover. |
| Destructive | coral outline with coral text, never a fill. |
| Round icon button | `ROUND_BUTTON`: 36px `glass-pill` circle. Used for search, tour and the ☰ menu. |
| Clock | `CLOCK_BUTTON`: a **solid cream** pill with navy text, the one solid control in the bar, like the reference's white clock button. It carries the demo date. |
| Chips | `glass-pill`, 24px high: Synthetic data, Demo data. Status chips stay shape + label first. |
| Coral tag | `bg-pink-500 text-black` pill, 20–24px. Used for "N overdue", "N need your approval" and late chips. |
| Focus ring | 2px `blue-400` (steel) outline with a 2px offset, everywhere. |

## 5. Shell structure

```
┌─ header (sticky, 48px: 6px gap + 42px glass-strong bar, fully round) ───────────────────────────┐
│ [mark Escheat Agent]      ( Overview · Work · Approvals · Books · Setup · Agents )    [chip][⌕][⌖][Nov 1, 2026][☰] │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
┌ glass Loop Bar (rounded-full; on the dashboard it sits below the hero instead) ───────────────────┐
│ Triage n › Draft n › Approve n › File n                                                  [next] │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
  main (full width, max 1360) → footer disclaimer          No rail at any width.

☰ menu sheet (glass-strong, 22px radius, right side, 8px inset)
  brand · company chip · Work / Books / Setup / Agents (every page) · Settings · Sign out · Collapse [
```

### Pill nav

- `components/shell/SectionNav.tsx` renders `NAV_SECTIONS` from `nav-items.ts`: six sections.
  - Overview → /dashboard
  - Work → /items, /payees, /forecast, /horizon, /what-if, /activity
  - Approvals → /approvals, with a coral count
  - Books → /ledger, /audit
  - Setup → /rules, /reports, /close-out, /recoveries, /settings
  - Agents → /runs, /chat, /theater, /eval
- The active section is an inner raised pill with a coral dot.
- `nav-items.test.ts` proves that every page belongs to exactly one section.
- The nav is visible at 1024px and up. At 1024–1279 the brand shows only its mark and the Synthetic data chip moves to
  the footer, so the bar fits.
- Sections with more than one page (Work, Books, Setup, Agents) have a small chevron after the label
  (`pill-nav-menu-<id>`). It opens a glass dropdown (`pill-nav-dropdown-<id>`, on hover or click, Escape closes) that
  lists the section's pages (`sectionPages()` in `nav-items.ts`, unit tested), with the current page marked by a coral
  dot. The label itself still goes straight to the section's first page.
- `SectionNav` is self-contained (its own pathname, counts in as a prop), so a mode switch can sit beside it later.

### No rail

- There is no left sidebar at any width. Navigation is the pill nav plus the round ☰ menu.

### Menu

- The ☰ round glass button ("Open navigation", with the coral approvals count) is in the bar at **every** width.
- It opens the menu sheet (`MobileNavSheet.tsx`, `data-testid="menu-sheet"`): the brand, the company chip, every page
  grouped Work / Books / Setup / Agents (`nav[aria-label="Main navigation"]`), Settings, Sign out and Collapse.
- `ShellFrame` passes the server-rendered nav body (`SidebarData`, with counts) to the sheet through `useShellNav()`.
  The sheet closes when the route changes.
- Collapse (and the `[` shortcut) still flips `data-collapsed`; the sheet then shows a compact 84px icon column. The
  link names stay (labels become sr-only).

### Removed and moved

- The breadcrumb is no longer in the bar; the pill nav carries location.
- The brand moved from the rail to the bar. The skip link is the first tab stop, ahead of the bar.

## 6. Atmosphere on every page

- The fixed backdrop is in the root layout.
- The shell (`ShellFrame`) and `/login` no longer paint opaque `ink-0`, so the bloom and ribs show through.
- Cards built from the primitives (`SectionCard`, `Panel`, `Card`, `EmptyState` with ghost, `ErrorState`, `elev-*`)
  are glass at an 18px radius.
- Raw `rounded-[10px] border border-line bg-ink-2` panels inside pages are still opaque navy. Converting them is the
  per-page follow-up in §8.

## 7. Dashboard stage

`app/(app)/dashboard/hero.tsx` and `hero-stage.tsx` follow the reference piece by piece:

- **First thing under the top bar.** The dashboard has no page header (the `h1` "Dashboard" is sr-only) and no Loop
  Bar above the hero. The stage is at least `max(600px, 100dvh − 76px)` tall at ≥ 1024px, so it fills the first
  viewport.
- **Headline.** "Outstanding, not yet filed", then **"$61,915.00 / owed to its owners."** (the real exposure), two lines
  of huge light cream type at the bottom left. Under it is one muted (fg-2) sentence carrying the real counts: the
  `exposure-meta` and `exposure-count` testids.
- **Glass panel, top right** (`hero-deadlines`).
  - It has a grab handle and a location line: "Nov 1, 2026 · CA, DE, TX".
  - Below that are the next two obligations as booking rows (`hero-deadline`), overdue first. Each row shows:
    - the payee and "STATE · $amount";
    - "Today / Nov 1" → a chip ("14 days", or a coral "3 days late") → "Report due / Nov 15";
    - an UNVERIFIED glyph when the date depends on an unverified rule.
  - The panel ends with a coral tag: "N overdue" or "N need your approval". When nothing waits on a person, the tag is
    steel.
  - The rows come from the pure model `hero-deadlines.ts`, which has unit tests.
- **CTA row.** At the bottom right, level with the copy: a coral pill (`hero-cta`) and a ghost "See every item ↗" link
  (`hero-ghost`). When a state's report is late the coral CTA is "Generate & file catch-up report" (the overdue item is
  already folded into the glass panel and its coral tag); otherwise it is the first thing waiting on a person.
- **Feature strip** (`feature-strip`). Five real places in the product:
  - Items: the open count;
  - Rules: deterministic, every date sourced;
  - Approvals: nothing is sent without approval;
  - Reports: replica portals only;
  - Recoveries.

  The first column is coral, with the short coral bar (`feature-bar`) on the hairline.
- **Below the fold** (`below.tsx`), a calm landing page, one idea per section. Each section has a light display title
  and one plain-English sentence under it (`DashSection`):
  1. one quiet row: the Core loop strip (`loop-slot`) and the CFO brief button (`cfo-brief-row`);
  2. **Where the money is**: the Money Map (lazy 3D, static fallback, reduced motion) with the per-state totals as big
     light numerals in glass cards (`Owed by state`), coral "N late" tags;
  3. **What is due next** (`due-next`): the overdue band (now a glass card with a coral edge, still `overdue-panel` with
     the catch-up button and late money), the next-90-days deadlines in a glass card, Needs you, and the UNVERIFIED
     notice;
  4. **Recent activity** (`recent-activity`): the last five audit-trail entries, linking to /activity;
  5. **More detail** (`dash-more`, a closed `<details>`): the money-flow Sankey, by status, audit interest and the
     featured check. Specs open it with `tests/e2e/dashboard-detail.ts`.

  Dropped from the page: the bucket row (by status covers it).
- **At 375px** the stage stacks in this order: headline, copy, glass panel, CTAs, then the strip as a horizontal
  scrolling row.

## 8. Per-page follow-up checklist

Apply this checklist to every page.

1. Convert raw `rounded-[10px] border border-line bg-ink-2` and `bg-ink-1` panels to `glass rounded-[18px]` (or
   `SectionCard` / `Panel`).
2. Make the page's one primary action the coral pill (`buttonVariants()` or `ActionButton`). Secondary actions become
   glass pills.
3. Restyle big figures as light numerals with a small muted sentence-case label above them (`KpiStat`).
4. Restyle tabs and segmented controls as pills.
5. Make chips `glass-pill` and status tags coral or steel. No green.
6. Change table rows to hover `fg-1/5%` and selected `fg-1/10%`. The steel rail on the keyboard row stays.
7. Check that drawers and sheets are glass (`ink-1/92` with blur), with a 22px radius on the visible edge.
8. Check AA with axe at 375, 1024 and 1440, with no horizontal overflow and the disclaimer visible.

Per-page notes:

- [ ] **Items** (`/items`):
  - Make the filter bar a glass pill row and the view tabs pills.
  - Make the table a glass card, and the bulk bar a floating glass pill with a coral primary.
  - Make the drawer glass.
- [ ] **Approvals** (`/approvals`):
  - Make the queue a list of glass rows like the booking cards.
  - Approve is coral; keep the desk preview's white paper.
  - Make the pipeline viz steel/coral.
- [ ] **Ledger** (`/ledger`):
  - Make the roll-forward figures big light numerals, and the journal table a glass card.
  - The Close pack button is secondary glass.
- [ ] **Horizon** (`/horizon`):
  - Retint the radar strokes to steel, with coral only for "needs you".
  - Make the controls pills.
- [ ] **Activity** (`/activity`):
  - Make the day strip steel bars and the entries glass rows.
  - Make "Chain verified" a steel glass chip.
- [ ] **Rules** (`/rules`):
  - Make the rules table a glass card and the field drawer glass.
  - The UNVERIFIED badges stay as they are.
- [ ] **Reports** (`/reports`):
  - Make the filing stepper a steel line with coral for the human step.
  - Make the report cards glass.
- [ ] **Runs** (`/runs`, `/runs/[id]`):
  - Make the step list glass rows and the screenshot lightbox a navy scrim.
  - Running status pulses steel.
- [ ] **What-if** (`/what-if`): make the timeline steel and the controls glass pills.
- [ ] **Theater** (`/theater`): make the model steps steel-600 fills (cream text) and human steps coral.
- [ ] **Close-out** (`/close-out/[state]`):
  - The runner controls are a coral primary.
  - The replica iframe frame stays white.
- [ ] **Audit** (`/audit`): make the drill cards glass and replace the blue blur blob with a steel haze.
- [ ] **Settings** (`/settings/*`): make the service rows glass, and the reset dialog glass with a coral confirm.
- [ ] **Replica portals** (`/replica/*`):
  - **Do not reskin.** They stay recognisably replicas, with their banner.
  - Only confirm that the app backdrop and grain stay hidden there.
- [ ] **Owner page** (`/owner/*`):
  - Give it the backdrop and a glass card for the owner's reply form, with a coral primary.
  - Keep the copy plain.
- [ ] **Login** (`/login`): done in V4 foundation (glass form panel, light display headline, coral submit). Polish the
  vault silhouette in steel.
- [ ] **Chat** (`/chat`): `chat.css` tokens are already remapped. Make the composer and cards glass.
- [ ] **Marketing** (`/`, `/how-it-works`, `/security`):
  - They pick up the tokens and the backdrop.
  - Re-check the 3D vault scene and section backgrounds against the stage look.

## 9. Files

| Area | Files |
|---|---|
| Tokens and recipes | `src/app/globals.css` |
| Shell | `src/components/shell/{Backdrop,SectionNav,MobileNavSheet,LoopBar}.tsx`, `loop-slot.tsx`, `chrome.ts`, `nav-items.ts`, `ShellFrame.tsx`, `HeaderData.tsx`, `SideNav.tsx`, `LoopBarView.tsx`, `MobileNav.tsx`, `DemoClock*.tsx`, `CommandPalette.tsx`, `Brand.tsx`, `src/app/(app)/layout.tsx` |
| Primitives | `ui/{button,card,dialog,sheet,popover,dropdown-menu,select,segmented}.tsx`, `primitives/{layout,v3,KpiStat,badges}.tsx`, `b/ActionButton.tsx` |
| Dashboard | `src/app/(app)/dashboard/{hero,hero-stage,hero-deadlines}.tsx/.ts`, `page.tsx` |
| Hard-coded colours | `chat.css` and chat views, `tour.css`, `vault-scene/{palette,shaders}.ts`, the letters, binder, CFO brief, close pack and evidence-pack PDFs/HTML, the owner-link preview, `draft.ts`, `proxy.ts` |
| Tests | `tests/e2e/ui-v4-foundation.spec.ts` (plus the rail/overdue-order updates in `ui-nav-speed`, `ui-r8-tour`, `ui-r9-polish`, `ui-v3-foundation`, `a11y-keyboard`, `ui-r4-approvals`, `ui-v3-approvals`, `ui-v3-perf`, `ui-overdue`, `ui-v3-dashboard`), `src/components/shell/nav-items.test.ts`, `src/app/(app)/dashboard/hero-deadlines.test.ts` |
