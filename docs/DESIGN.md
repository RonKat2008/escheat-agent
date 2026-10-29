# Escheat Agent: UI Design Spec (hand this to the UI builders)

Stack: Next.js App Router, Tailwind v4, shadcn/ui, Recharts. Must visually match the pitch video (`escheat-agent-video/docs/video-spec.md`): navy `#0B1220`, surface `#121A2B`, amber = at risk, green = resolved, Inter + JetBrains Mono, tabular numerals, 150-300ms ease-out, no bounce.

Direction (one sentence): **"Quiet ledger at night."** A dark, dense, numbers-first compliance console, closer to a trading blotter / Linear than a SaaS dashboard. The page is mostly calm navy; amber appears ONLY where money is at risk or a deadline is near, green ONLY where something is resolved. If everything is amber, nothing is. Hierarchy comes from scale contrast (one huge mono exposure number, many 12-13px labels), not from colored cards.

Verification note: npm versions below were checked against the registry on 2026-10-29. Reference-product pattern notes marked (V) were confirmed by fetching vendor docs; the rest are well-known public product behavior from memory (ramp.com/mercury.com marketing pages are image-only and could not be read as text). Builders should open the URLs for visual reference.

---

## 1. Reference products and what to borrow

| Product | URL | Borrow |
|---|---|---|
| Ramp | https://ramp.com/accounts-payable , https://ramp.com/expense-management | Approval-queue-first mental model: a "needs your review" list sorted by dollar amount, item details visible before any action, required reason on reject (V: Ramp's approval-dashboard agent skill describes exactly this order). Dense tables with one bold amount column, receipt/evidence thumbnail inline. Ramp's restraint: one accent on near-neutral surfaces. |
| Mercury | https://mercury.com | Big balance number as the page hero with small muted label above and a quiet sparkline; transaction rows with a single status chip; global search/command bar. Generous hero scale vs tiny labels. |
| Linear | https://linear.app/docs/display-options (V) | Grouped list by status with count in group header; display options toggle which columns show; keyboard-first (`j/k`, `Enter` open, `Esc` close, `Cmd+K`); status icons are shapes (circle, half, check), not only colors; peek drawer on the right keeps the list visible. |
| Stripe Dashboard | https://docs.stripe.com/stripe-apps/design (V) | Details page vs list page vs home surfaces; side drawer in context (ContextView) for glance, blocking focus drawer (FocusView) for a start-to-finish task. Use the same split: `/items` row click = non-blocking context drawer; Approve = blocking focus sheet with the diff. Intentionally limited color so contrast stays accessible. Events/timeline on object pages with copyable IDs. |
| Vercel Geist | https://vercel.com/geist/badge (V) | Badge rules: one badge per row, Title Case 1-2 words, color maps to meaning, no check/X icons duplicating the color (we deviate: we add shape icons because our palette is narrow and a11y needs non-color cues), badges are static not clickable. Status dot for dense cells. Deployment log / build-step list is the model for `/runs`. |
| Brex | https://www.brex.com/product/spend-management | Policy-as-visible-rule UI: show the rule that triggered a flag next to the item. Reuse for "rule version + source" on every date. |
| Pilot | https://pilot.com | Calm monthly-close checklist feel; "what we did for you" activity feed. Reuse for the activity feed on the dashboard. |
| Tremor / Vercel templates | https://tremor.so (blocks), https://vercel.com/templates/next.js/next-js-dashboard-template (shadcn admin) | KPI row anatomy, "category bar" (a stacked horizontal bar with legend) for the CA/TX/DE split, progress/meter patterns. Take anatomy only; do not ship their default card grid (anti-template policy). |
| shadcn charts | https://ui.shadcn.com/docs/components/chart (V) | `ChartContainer` + `ChartConfig` + CSS vars `--chart-N`; Recharts v3; custom `ChartTooltipContent`. Our chart colors must be our status tokens, not the default palette. |

Patterns to emulate, by surface:
- KPI/exposure header: one hero number (mono, 56-72px, NumberFlow count-up, amber), label above in 12px caps muted, delta/"as of {demo clock date}" below. Beside it a thin segmented bar for CA/TX/DE with amounts. No icon-in-circle KPI cards.
- Data table w/ filters: Linear-style filter bar (chips, `+ Filter`), grouped headers optional, sticky header, 36px rows, right-aligned mono amounts, saved view tabs ("All 47", "Needs action", "Due in 90d").
- Detail drawer + timeline: vertical rail with nodes; past nodes filled, next node amber ring, future nodes hollow; each node shows date (mono), rule name+version, source link, UNVERIFIED badge if applicable.
- Approval queue: master-detail; left list sorted by amount/deadline, right pane shows exactly what will be sent (letter PDF preview, email body, call script, report diff), sticky footer with Reject (requires reason) and Approve.
- Audit trail: append-only table, mono timestamps, actor chip (Agent / You / System), hash or ID, no edit affordances.
- Agent trace viewer: Vercel build-log/Langfuse style: collapsible steps with duration, tool-call blocks (input JSON / output JSON in mono), citation chips, per-step tokens and cost, total at top.
- Empty states: one line of plain explanation + the single next action + (for agent-driven) "Nothing needs you. The agent is watching N items." No illustrations.

---

## 2. Dependencies (aim <= 6 new)

Already in stack, keep: next, tailwindcss 4.3, shadcn (CLI 4.x), recharts 3.10 (shadcn chart is Recharts v3), date-fns 4, lucide-react 1.x, zod.

| # | Package (checked version) | Why | Weight/flags |
|---|---|---|---|
| 1 | `motion` ^14.7 (import from `motion/react`) | Drawer/sheet enter, list reorder with `layout`, timeline node reveal, approval-success transition. Use `LazyMotion` + `m` components and `domAnimation` to cut bundle. | Package unpacked is large (~900KB) but tree-shakes; with LazyMotion ~5-6KB initial. Use transform/opacity only. |
| 2 | `@number-flow/react` ^0.6.2 | Count-up exposure number ($61,915.00 ticks), counters that change when demo clock advances or an item is approved. Respects reduced motion by default; React 19 OK. | ~25KB unpacked, tiny. 0.x so pin exact. |
| 3 | `@tanstack/react-table` pin **8.21.3** (NOT latest 9.3.1) | Headless table: sorting, filtering, column visibility, row selection. v9 is a new modular/store-based API with sparse examples; shadcn data-table docs target v8. Pin `~8.21.3`. | Headless, ~15KB gz. Skip `@tanstack/react-virtual`: 47 rows, 200 eval rows do not need it (paginate eval). |
| 4 | `sonner` ^2.0.8 | Toasts for approve/reject, optimistic feedback, errors with Undo. shadcn `sonner` component wraps it. | ~174KB unpacked, ~4KB gz. |
| 5 | `cmdk` ^1.1.1 | Cmd+K palette (jump to item #10482, pages, "Fast-forward demo clock"). shadcn `command` wraps it. Last release Aug 2025, widely used, React 19 OK. | ~10KB gz. |
| 6 | `nuqs` ^2.10 | Filters/sort/tab/drawer-open item id live in the URL (`/items?state=CA&status=to_report&item=10482`). Deep links make the demo recoverable and match the user's web-patterns rule "URL as state". | ~6KB gz, App Router native. Optional; drop first if cutting. |

Explicitly NOT adding:
- `vaul`: last published Dec 2024, effectively unmaintained; it is a bottom-sheet drawer for mobile. Use shadcn `Sheet` (Radix Dialog) for the right drawer. On 375px the Sheet becomes full-width.
- `react-day-picker`: demo clock = a compact control with "+1 day / +30 days / +1 year / Jump to next deadline" buttons plus a plain `<input type="date">`. Add the shadcn Calendar only if time remains (react-day-picker 10.x exists but v9 to v10 API changes add risk).
- Aceternity / Magic UI: skip. Their effects (aurora, meteors, beams) read as templates and break the "quiet ledger" direction. One exception allowed if wanted: a subtle `border-beam`-style 1px sweep on the single "Awaiting approval" button; not required.
- 21st.dev: use as inspiration/source via `21st-cli-use` skill, then re-skin to our tokens. Do not ship a component un-restyled.
- `framer-motion` (superseded by `motion`), `react-countup` (NumberFlow replaces), any icon pack besides lucide.

Fonts: `next/font/google` Inter (variable, `display: swap`, weights via variable) and JetBrains Mono. Two families only.

---

## 3. Claude Code skills for the UI builders (invoke order)

Local skill list was checked; every name below exists. `dataviz` and `artifact-*` are the only ones that are not under the `ecc:` prefix besides those noted.

| Skill | Use it when |
|---|---|
| `frontend-design:frontend-design` | FIRST, once per builder, before writing any page: locks the aesthetic POV so output is not templated. Feed it this doc's "Direction" line. |
| `ecc:frontend-design-direction` | Alongside the above for the ECC anti-template checklist; re-run when a page feels generic. |
| `ecc:design-system` | When creating `globals.css` tokens, `components/ui/*` variants (Badge/StatusPill, Surface, Stat), and the token file in section 4. One builder owns this; others consume. |
| `vercel:shadcn` | Installing/composing shadcn components (`sheet`, `command`, `sonner`, `table`, `chart`, `tabs`, `badge`, `skeleton`) and Tailwind v4 theming (`@theme inline`). |
| `ecc:dashboard-builder` | `/dashboard`, `/runs`, `/eval` layouts: KPI rows, tables, charts structure. |
| `dataviz` | Before ANY Recharts chart (state split bar, deadline histogram, audit-interest meter, eval accuracy bars): palette, axes, tooltips, legend rules, dark mode. Override its palette with our status tokens; keep its accessibility and stat-tile guidance. |
| `ecc:motion-foundations` | Once: motion tokens, reduced-motion handling, SSR safety with `motion/react`. Replace any spring presets with our ease-out tokens (no bounce). |
| `ecc:motion-patterns` | Drawer, toast, stagger on table rows, page transition, modal. Cap stagger at 30ms x 10 rows. |
| `ecc:make-interfaces-feel-better` | Final polish pass per page: hit targets, optical alignment, concentric radii, hover/active/focus states, text-wrap balance, tabular nums. |
| `21st-ui-build` and `21st-cli-use` | When building a complex piece (data table toolbar, timeline, command palette): search 21st for a grounded starting point, then restyle to tokens. `components.json` exists so it auto-applies. |
| `ecc:accessibility` / `ecc:frontend-a11y` | After each page: keyboard map, focus order, ARIA for drawer/table/timeline, reduced motion, contrast (our tokens are pre-checked in section 4). |
| `ecc:browser-qa` | Last, per page: screenshots at 375/768/1024/1440, console errors, layout shift, click-path checks. Use before declaring a page done. |
| `21st-ui-review` | Optional independent critique of a finished page. |

---

## 4. Design system spec

### 4.1 Color tokens (dark is the product; light only for `/owner/[token]`)

Contrast ratios computed (WCAG, relative luminance) against bg `#0B1220` / surface `#121A2B` / raised `#182236`.

```css
:root {
  /* surfaces */
  --bg:            #0B1220;   /* app canvas (video bg) */
  --surface:       #121A2B;   /* cards, panels, table body (video surface) */
  --surface-raised:#182236;   /* drawer, popover, hovered row */
  --surface-sunken:#080E1A;   /* code blocks, trace payloads, input wells */
  --border:        rgba(255,255,255,0.08);   /* video border */
  --border-strong: rgba(255,255,255,0.16);   /* inputs, focused cards */
  --grid-line:     rgba(255,255,255,0.035);  /* optional page grid texture */

  /* text */
  --text:          #E8ECF3;   /* 15.8 / 14.7 / 13.4  AAA */
  --text-muted:    #8A94A7;   /* 6.1 / 5.7 / 5.2     AA, labels + secondary */
  --text-subtle:   #6B7589;   /* 4.0 / 3.75          FAILS AA for text: use for disabled, placeholder-only, decorative separators. Never for content. */
  --text-on-accent:#0B1220;   /* on solid amber/green fills: 9.2 / 8.2 */

  /* accent system (video: ONE system) */
  --amber:         #F5A524;   /* 9.2 / 8.5 / 7.8  at risk, due soon, awaiting you */
  --amber-soft:    rgba(245,165,36,0.14);   /* pill fill */
  --amber-line:    rgba(245,165,36,0.45);   /* pill outline; "Prototype" tag uses 0.6 */
  --green:         #22C55E;   /* 8.2 / 7.6 / 7.0  resolved, found, remitted */
  --green-soft:    rgba(34,197,94,0.14);
  --green-line:    rgba(34,197,94,0.40);
  --red:           #FF7A7F;   /* 7.4 / 6.9  errors, rejected, failed eval. The video's #E5484D is 4.4 on surface, below AA for small text: use it only for the stamp/large shapes. */
  --red-soft:      rgba(255,122,127,0.14);

  /* neutral status hues (low saturation, so amber/green keep meaning) */
  --slate:         #9AA6BD;   /* 7.6 / 7.1  watching, reported (neutral progress) */
  --slate-soft:    rgba(154,166,189,0.14);
  --sky:           #7DD3FC;   /* 11.2 / 10.4  owner_responded (information, external event) */
  --sky-soft:      rgba(125,211,252,0.13);

  /* focus */
  --ring:          #7DD3FC;   /* 2px, offset 2px; sky chosen so it never reads as status */

  /* charts */
  --chart-1: var(--amber);  --chart-2: var(--slate);  --chart-3: var(--sky);
  --chart-4: var(--green);  --chart-grid: rgba(255,255,255,0.06);
}
```

State identity (for CA/TX/DE chips and bar segments; distinguish by label + lightness, not hue, to avoid colliding with status): CA `#E8ECF3` at 100%, TX `#E8ECF3` at 62%, DE `#E8ECF3` at 34% (white ramp) with 2-letter mono label. Amounts: CA $28,410, TX $19,862, DE $13,643 (sum $61,915, per video).

Light theme, owner page only:
```css
.theme-owner { --bg:#FAF8F4; --surface:#FFFFFF; --text:#0F172A; /*17.9*/ --text-muted:#475569; /*7.2*/
  --border:rgba(15,23,42,0.12); --amber-ink:#92400E; /*6.4 on #FEF3C7*/ --green-ink:#166534; /*6.5 on #DCFCE7*/
  --accent:#0B1220; /* buttons: white text 18.7 */ }
```

### 4.2 Status pill system (stale_items.status)

Rules: ONE pill per row; 22px high, radius 999px, 12px/500 Inter, `letter-spacing:.01em`, leading 12px lucide icon (shape = redundant non-color cue), Title Case 1-2 words. Fill = `*-soft`, 1px border = `*-line`, text = full color. "Active attention" states use a solid fill variant to pop in the table.

| status | Label | Color | Icon (lucide) | Style | Meaning |
|---|---|---|---|---|---|
| `watching` | Watching | slate | `Eye` | soft | Tracked, not yet stale/presumed abandoned |
| `dd_pending` | DD Due | amber | `Hourglass` | soft + amber outline | Due-diligence letter must go out; approval needed |
| `dd_sent` | Letter Sent | amber | `MailCheck` | outline only (transparent fill) | Waiting on owner; clock running |
| `owner_responded` | Owner Replied | sky | `MessageSquareReply` | soft | Needs review; may become resolved |
| `resolved_paid` | Paid Out | green | `CheckCircle2` | soft | Resolved, no escheat |
| `to_report` | To Report | amber | `FileWarning` | SOLID amber fill, `--text-on-accent` | Highest urgency: report due |
| `reported` | Reported | slate | `FileCheck2` | soft | Filed, awaiting remittance confirmation |
| `remitted` | Remitted | green | `BadgeCheck` | SOLID green fill, `--text-on-accent` | Done, remitted to state |

Sort weight for default order: to_report, dd_pending, owner_responded, dd_sent, watching, reported, resolved_paid, remitted.

Component API: `<StatusPill status="to_report" />` reads from a single `STATUS_META` map (label, tone, icon); never inline colors elsewhere. Also provide `<StatusDot>` for dense cells and chart legends.

Other badges:
- **UNVERIFIED** (rule value with `verified:false`): amber *dashed* outline (dashed is unique to this badge, so it never reads as a status), text `UNVERIFIED` 10.5px/600 caps, tracking .08em, `ShieldQuestion` icon, bg transparent, text amber. Tooltip: "This value has no verified official source yet. The engine will output UNKNOWN rather than guess." Appears next to every date/value derived from it, in drawer, rules page, reports, approvals.
- **Prototype** tag (every screen, top-right, 24px inset, per video): use 12px caps tracking .08em in the app chrome (the video's 14px is 1080p-scale; 12px matches visually at app scale), amber text, `1px solid rgba(245,165,36,.6)`, radius 999px, plus the persistent footer line "Prototype. Not legal advice. Confirm filings with a qualified professional." (hard rule 8) in `--text-muted` 12px, inside the app shell footer, never hidden on mobile.
- **SYNTHETIC DATA** micro-tag in the footer beside the legal line.
- **Source chip**: `[statute icon] Cal. CCP §1517 ↗` mono 11px, `--surface-sunken` bg, opens official source_url in new tab. Verified sources get a tiny green dot; unverified get the UNVERIFIED badge instead.
- **Actor chip** (audit): Agent (sky outline), You (text on raised), System (slate).

### 4.3 Typography
- Inter (UI), JetBrains Mono (amounts, check numbers, IDs, dates in timelines, code, hashes). `font-variant-numeric: tabular-nums; font-feature-settings: "tnum","cv11","ss01"` on `body`; mono has native tabular.
- Scale (px, size/line, weight): Hero-number 64/64 mono 600 (clamp 40-72); H1 page title 24/32 600 (-0.01em); H2 section 15/24 600; Body 14/20 400; Table cell 13/20; Label/caps 11/16 500 caps tracking .08em muted; Caption/source 12/16 muted at 60% (matches video 13px source lines at 60%); Mono-sm 12/16.
- Rule: at most 3 sizes visible per card. Big number + tiny label is the signature move.
- `text-wrap: balance` on headings, `pretty` on paragraphs.

### 4.4 Spacing, radius, elevation
- Base 4px. Rhythm is intentionally uneven: page gutter 24 (16 on mobile); between major sections 32; inside cards 20 (hero card 28, dense table card 0 with 12/16 cell padding); label-to-value gap 6; row height 36 (dense) / 44 (touch <768).
- Radius scale, varied on purpose (video: "vary radius"): hero/feature card 16, standard card/panel 14 (video), table container 12, inputs/buttons 8, chips/pills 999, small code/source chip 6, drawer: 16 on its inner-left corners only. Concentric rule: inner radius = outer - padding.
- Elevation: flat by default (1px border, no shadow). Raised (drawer, popover, command palette): `0 24px 60px -12px rgba(0,0,0,.55), 0 0 0 1px var(--border)`. Hero card gets a top inner highlight `inset 0 1px 0 rgba(255,255,255,.05)` and a very faint amber radial `radial-gradient(600px 200px at 0% 0%, rgba(245,165,36,.07), transparent)` (atmosphere, not a blob). Page background: `--bg` + 2% noise png/svg + optional 48px grid at `--grid-line`, masked to fade by 40vh.
- Borders do the work of separation: row dividers `--border`, no zebra.

### 4.5 Motion tokens
```css
--dur-fast:150ms; --dur-base:220ms; --dur-slow:300ms;
--ease-out: cubic-bezier(0.22, 1, 0.36, 1);   /* power3.out-like */
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);  /* only for layout shifts */
```
- No spring with overshoot, no bounce/elastic. Motion `transition={{ duration:.22, ease:[.22,1,.36,1] }}`.
- Stat/card entrance (matches video): translateY(16px; video uses 40px at 1080p), blur(8px)->0, opacity 0->1, 300ms, stagger 40ms, max 6 items. `filter: blur` ONLY on first mount, not on data updates.
- Drawer: translateX(24px)+opacity, 220ms. Table row hover: bg change 150ms only. Number changes: NumberFlow (default ~900ms is too slow for the UI; set `transformTiming={{duration:400, easing:'cubic-bezier(.22,1,.36,1)'}}`), hero count-up on first load 700ms only.
- Pending-approval indicator: 2s opacity pulse 1 -> .55 on a 6px amber dot (transform/opacity only).
- Only animate transform/opacity/filter/clip-path. `prefers-reduced-motion`: remove translate/blur, keep opacity <=150ms, NumberFlow `respectMotionPreference` stays true.

### 4.6 Focus, hit targets, interaction states
- Focus ring: `outline: 2px solid var(--ring); outline-offset: 2px;` on `:focus-visible` only; inside dense table cells use `outline-offset:-2px`. Never remove outlines.
- Buttons: Primary = solid `--text` on dark (bg #E8ECF3, text #0B1220, 14.7:1), hover bg white, active scale .98 (100ms), disabled 40%. Approve = amber solid (text-on-accent). Destructive/Reject = ghost with `--red` text. Hit target >=36px (44px on touch).
- Row hover: `--surface-raised`; selected row: 2px left bar in amber + raised bg; keyboard-active row: same plus ring.
- Links: underline on hover, source links get `↗`.

### 4.7 Replica portal style (`/replica/*`, visibly NOT our app)

Goal: looks like a 2008-era government site. Separate root layout (`app/replica/layout.tsx`) that does NOT import the app theme; own CSS file with a hard reset; no Tailwind dark tokens, no Inter, no rounded corners, no shadows.
- Fonts: `Georgia, "Times New Roman", serif` for headings; `Arial, Helvetica, sans-serif` 14px for body/forms. Default blue links `#0000EE`/visited `#551A8B`.
- Canvas white `#FFFFFF`; header band flat `#E6E6E6` with 1px `#999` border, a generic neutral emblem (a plain grey rectangle with text "STATE SEAL PLACEHOLDER": NEVER a real seal), title like "State Unclaimed Property: Holder Reporting" (generic, per video; per-state variants use fictional names: "Replica State of California Unclaimed Property Division" is fine if prefixed REPLICA).
- Forms: native inputs with 2px inset borders, grey `#F0F0F0` buttons with square corners, table-based layout with `<fieldset><legend>`. Required fields marked red asterisk. Hit area standard.
- **Banner (loud, impossible to miss), sticky top, on every replica page and also inside the filing-agent preview:**
  `background: repeating-linear-gradient(45deg,#B00020 0 16px,#8E001A 16px 32px); color:#fff; font:700 16px/1 Arial; letter-spacing:.06em; text-align:center; padding:12px; border-bottom:4px solid #000;` text: `REPLICA - NOT A REAL STATE SYSTEM. Demo environment for a hackathon prototype. Do not enter real data.`
- Also: a 1px red `#B00020` page border, bottom banner repeating, and a faint diagonal "REPLICA" watermark (`background-image` SVG at 6% opacity) behind content. A tiny link "Back to Escheat Agent" in the footer.
- Button focus: native browser focus plus 2px `#000` outline (it is a plain site, not our ring).
- Contrast for the replica is standard black on white (21:1) with link blue 8.6:1.
- Agent run view in OUR app (`/runs`) shows the replica in an `<iframe>` or screenshot with our chrome around it labeled "Replica portal (sandboxed)", so the demo shows both visuals side by side.

---

## 5. Page specs

Global shell: left rail 56px collapsed icons / 220px expanded (default 220 >=1280, 56 at 768-1279, bottom tab bar <768 with 5 items + "More"). Top bar 48px: breadcrumb/title left, center Cmd+K trigger ("Search items, pages, actions  ⌘K"), right: demo-clock chip ("Demo date: 2026-11-02" mono, click to open clock popover), Pending approvals bell with count dot, Prototype tag. Footer (always visible under content, not fixed): legal line + SYNTHETIC tag. Nav order: Dashboard, Items, Approvals (count), Rules, Reports, Recoveries, Runs, Eval. Settings under avatar.

### /dashboard
```
┌ Dashboard ───────────────────────────── Demo date ▾  ⌘K  [Prototype]┐
│ EXPOSURE (hero card, 16px radius, amber atmosphere)                  │
│  AT RISK TODAY                          BY OWNER STATE               │
│  $61,915.00   ← 64px mono amber         ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇ 3-seg  │
│  47 stale items · as of Nov 2           CA $28,410 · 21 │TX $19,862 · 15 │DE $13,643 · 11 │
│  [Open items →]  [Fast-forward clock]                                │
├──────────────────────────────┬───────────────────────────────────────┤
│ DEADLINES · NEXT 90 DAYS     │ STATUS COUNTS                         │
│ histogram by week, bars      │ 8 rows: dot+label ........ count      │
│ amber (<=14d) / slate (later)│ to_report 0 · dd_pending 12 ...       │
│ list: Nov 1 CA report 21 …   │ (click row = /items?status=…)         │
├──────────────────────────────┼───────────────────────────────────────┤
│ FEATURED · CHECK #10482      │ AUDIT-INTEREST METER                  │
│ Bayline Electric  $2,340.00  │ semicircle/linear gauge: "interest if │
│ CA · issued 14 mo ago        │ unreported" vs principal, amber fill  │
│ mini timeline 5 nodes        │ number from rules engine only; shows  │
│ [View timeline] [Approve     │ UNVERIFIED badge if rate unverified.  │
│  letter ⏎]                   │ NO invented statistics.               │
├──────────────────────────────┴───────────────────────────────────────┤
│ AGENT ACTIVITY (feed)  •  Recovery: $1,180.00 found (green)  → /recoveries │
└──────────────────────────────────────────────────────────────────────┘
```
Notes: hero number uses NumberFlow; the segmented bar uses the white ramp, not hues. Featured card is the demo anchor: slightly larger radius (16), raised border-strong, the only card with a CTA. Audit-interest meter: use the exact rule fields (rate, start date) from `rules/*.json`; if null render "Unknown" state with todo text, never a number. Grid: 12 col, hero spans 12, then 7/5, then 5/7 (deliberately unequal).

### /items
```
Items  [All 47] [Needs action 12] [Due ≤90d 9] [Resolved]         [+ Filter] [Columns] [Export]
Filter chips: State: CA ×  Status: Letter Sent ×  Type: Vendor check ×     search ____
┌────┬──────────┬─────────────────┬──────┬──────────┬─────────┬──────┬────────────┬───────────┐
│ ☐  │ Check #  │ Payee           │ St.  │ Amount   │ Type    │Issued│ Next deadline│ Status  │
│    │ 10482    │ Bayline Electric│ CA   │ 2,340.00 │ Vendor  │ 14mo │ Nov 1 · 24d  │ ◔ DD Due│
└────┴──────────┴─────────────────┴──────┴──────────┴─────────┴──────┴────────────┴───────────┘
```
- Table: sticky header, 36px rows, amounts right-aligned mono, deadline chip amber when <=30d, state as 2-letter mono chip, "Unknown" in muted italic with `HelpCircle` when engine outputs UNKNOWN (never blank). Footer: "47 items · $61,915.00" live total of filtered set.
- Bulk select shows a bar: "Approve letters (n)" which routes to /approvals, never sends directly.
- Row click (or `Enter`) opens right **Sheet** 480px (non-blocking: list stays visible and focused row highlighted; `j/k` moves between items while drawer is open, drawer updates):
```
┌ #10482 · Bayline Electric           [◔ DD Due]  ✕ ┐
│ $2,340.00  ·  Vendor check  ·  CA owner address     │
│ State chosen because: owner's last known address    │
│ ─ TIMELINE ─────────────────────────────────────── │
│ ● Issued            Sep 12, 2025                    │
│ ● Stale (180d)      Mar 11, 2026   business setting │
│ ● Presumed abandoned  Sep 12, 2028  CA vendor_check │
│     rule ca@v3 · dormancy_years 3 · Cal. CCP §1513 ↗│
│     [UNVERIFIED if so]                              │
│ ◉ Due-diligence window  opens … closes …   ← NEXT   │
│ ○ Report due        Nov 1                           │
│ ○ Remit             Nov 1                           │
│ ─ EVIDENCE · LETTERS · CALLS · AUDIT (tabs) ─────── │
│ [Approve letter]  [Mark resolved]                   │
└─────────────────────────────────────────────────────┘
```
(The above dates are layout placeholders; real dates come only from the rules engine. Every node has: date mono, name, rule id+version, one source chip, UNVERIFIED badge if flagged. Past nodes filled slate, current node amber ring + soft glow, future hollow.) Tabs: Timeline / Activity (audit trail) / Messages. On <768 the sheet is full-screen with back arrow.

### /approvals
```
┌ Queue (12) ───────────────┬ #A-031 · Mail due-diligence letter · Bayline Electric ─────────┐
│ sorted: urgency ▾         │ WHAT WILL HAPPEN                                              │
│ ◔ Letter · $2,340 · Nov 1 │ Certified letter via Lob (TEST MODE) to 123 … CA              │
│ ✉ Email · $880 · …        │ ┌ preview (PDF render) ───────────────┐  Rule: ca@v3  [source]│
│ ☎ Call · …                │ │                                     │  Why now: DD window   │
│ 📄 Report CA · 21 items   │ └─────────────────────────────────────┘  opens in 3 days      │
│ ⚖ Rule change · TX        │ For rule changes / reports: DIFF view (red/green line diff,   │
│                           │ before/after values, UNVERIFIED flags called out).            │
│ keyboard: j/k, A approve, │ Safety checks: ✓ Test mode ✓ Allowlisted recipient ✓ Synthetic │
│ R reject                  │ ───────────────────────────────────────────────────────────── │
│                           │ [Reject… (reason required)]            [Approve & send ⏎]     │
└───────────────────────────┴───────────────────────────────────────────────────────────────┘
```
- Type icons for each irreversible step (letter, email, call, report submission, claim, rule change).
- Approve button is amber solid. After click: optimistic row collapse (220ms), toast "Letter queued (test mode) · Undo 5s" ONLY for reversible steps; truly irreversible ones use a confirm step in the same footer ("Confirm: submit report to REPLICA portal"). The server is the source of truth; UI shows the pending state until the server confirms (do not fake success).
- Empty: "Nothing needs approval. The agent is watching 47 items." 

### /rules
- Left: tabs CA / TX / DE with an "N unverified" badge. Main: table of rule fields per property type: Field, Value, Source, Verified, Version, Effective.
```
Field                    Value        Source                         Status
dormancy_years (vendor)  3            Cal. CCP §1513 ↗               ● Verified
dd_notice_window_days    null         —                              UNVERIFIED · TODO  [Research with agent]
```
- Null renders `Unknown` + todo, never a guess. Right panel when a pending rule change exists: version diff (v2 -> v3), side-by-side values, citations the research agent found (quote + URL), `[Approve rule change]` (goes through /approvals). Version selector dropdown; history list with who approved.

### /reports
- Table of reports by state/period: status (Draft, Validated, Awaiting Approval, Submitted to Replica, Confirmed), item count, total (mono), validation result. Detail: left = report preview in a mono/table "file" view (NAUPA-like columns), right = validation checklist with pass/fail rows, errors link to the item. Submit = goes through approvals. Confirmation number shown in a green panel with copy button.

### /recoveries
- Hero strip: "$1,180.00 found" in green (mono 48px) + "Replica state search · 1 match". Table: matched record, name variant matched vs company name (highlight the differing characters in amber), confidence + reason, amount, status (Found, Claim Drafted, Awaiting Approval, Submitted). Detail drawer shows claim draft + evidence. Green is allowed here only because it means "found".

### /runs (agent trace viewer)
```
Runs  [Agent ▾][Status ▾]    run_0192  Filing agent · CA · 00:42 · 18.4k tok · $0.031  [Awaiting approval]
┌ Steps ──────────────────────┬ Step 7 · tool: portal.fill_field ─────────────────────────┐
│ ✓ 1 Plan            0.8s    │ Input   {selector:"#holder_name", value:"Northwind …"}    │
│ ✓ 2 Load rule ca@v3 0.1s    │ Output  {ok:true}                                          │
│ ✓ 3 portal.open     1.2s    │ Citations: [rule ca@v3 §…] [source ↗]                      │
│ ▸ 7 portal.fill_field …     │ Tokens in 1,204 / out 88 · $0.0009 · 412ms                 │
│ ◔ 12 Approval gate  (wait)  │ Screenshot thumbnail (replica) with REPLICA banner visible │
└─────────────────────────────┴────────────────────────────────────────────────────────────┘
```
- Vertical step list with duration bars (width proportional, via `transform:scaleX`), collapsible tool blocks with JSON in `--surface-sunken` mono, copy buttons, citation chips, per-step and total tokens/cost in the header, live-run state streams new steps in with the 220ms entrance. Approval-gate step has the amber pulsing dot and a link to /approvals. If ANTHROPIC key missing: banner "Not configured: showing recorded run" (honest label).

### /eval
- Top row: 4 stat tiles (overall accuracy, items, adversarial subset accuracy, last run time): mono, tile radii alternate 14/10. Charts: horizontal bar per field (state, property type, dormancy start, deadline): accuracy %, with the target line; per-slice grouped bars (generated 160 vs adversarial 40, by state, by property type). Error list table below: item id, field, expected vs got (diff highlighted), slice, [Open in trace]. Do not show any accuracy number that was not computed from the stored eval run; if no run exists, empty state with `Run eval` button.

### /owner/[token] (public, light theme OK)
- Single centered column 560px, `.theme-owner`: warm off-white, ink navy text, Inter 16px body (bigger than app), one navy primary button. Content: friendly header "Northwind Fixtures, Inc. may be holding money for you", amount, short plain-language what-this-is, reason, deadline, 3 actions (Yes this is mine / No / Need help), identity step, upload ID placeholder (synthetic only), reassurance + the legal disclaimer + "Prototype" tag. No dashboard chrome, no sidebar. Mobile-first (375). Expired/invalid token -> friendly error with no data leakage. After submit: green check panel + "What happens next".

### Replica portals (`/replica/[state]/...`)
- Per 4.7. Pages: home with 3 links (Holder Reporting, Search for Property, Contact), login-less holder reporting form (multi-section), upload page, confirmation page with confirmation number; owner-search page + results table + claim form. Banner on top and bottom of every page.

---

## 6. "Clean UI in every moment" checklist

Loading
- [ ] Every data region has a skeleton matching final dimensions (row heights 36, hero number box 64px), shimmer via opacity pulse on `--surface-raised`, no spinners except button-inline.
- [ ] Route-level `loading.tsx` per page; Suspense per card so the hero loads first.
- [ ] No layout shift: fixed heights for hero/stat/chart (ChartContainer with explicit `h-*`), `font-display: swap` with `size-adjust` (next/font handles), images with width/height, reserve toast area, scrollbar-gutter: stable.

Empty
- [ ] Each list: line of explanation + one action (see section 1). Filters-with-no-results: "No items match. Clear filters" button.
- [ ] Null rule values: `Unknown` + todo, never blank, never a guess.

Error
- [ ] Per-card error boundary with "Couldn't load X. Retry" (no whole-page crashes); `error.tsx` per route; `not-found.tsx`.
- [ ] Missing key/integration: honest "Not configured" panel naming the env var (hard rule 9).
- [ ] Server action failures: toast with reason + the form keeps its input.

Feedback
- [ ] Optimistic updates for reversible UI state only (filters, dismiss, mark read); irreversible steps show a pending state until the server confirms, then a toast with link to the audit entry.
- [ ] Button pending state: label stays, spinner replaces icon, width fixed, `aria-busy`.
- [ ] Toasts: Sonner bottom-right, 4s, never cover the approval footer (offset 80px on /approvals), error toasts persist.

Keyboard and a11y
- [ ] Cmd+K palette; `g d`/`g i`/`g a` go-to chords; `j/k` row nav; `Enter` opens; `Esc` closes drawer and returns focus to the row; `A`/`R` on approvals; shortcut cheatsheet on `?`.
- [ ] Drawer: focus trap when blocking, focus return, `aria-labelledby`; table `role=grid` semantics via TanStack; status communicated by text+icon not color alone; timeline is an `<ol>` with `aria-current="step"`.
- [ ] Contrast: only use text tokens listed >=4.5:1; `--text-subtle` never for content.
- [ ] `prefers-reduced-motion` verified; touch targets >=44px on mobile.

Responsive (verify 375, 768, 1024, 1440; also 320 no horizontal scroll)
- [ ] 375: bottom tab bar, hero number clamps, table becomes stacked "row cards" (payee + amount top line, status pill + deadline second line), drawer full-screen, approvals master-detail becomes two screens, filter bar horizontally scrollable chips.
- [ ] 768-1024: rail collapsed, 8-col grid, drawer 420px overlay.
- [ ] 1440: max content width 1280 centered; drawer 480px pushes content (no overlay) when space allows.
- [ ] No page-level horizontal scroll; wide tables scroll inside their container with sticky first column.

Polish
- [ ] `tabular-nums` on every number; currency always 2 decimals except hero rounding rules from video ($61,915 shown as $61,915.00 in app).
- [ ] The legal footer line and Prototype tag on every screen including owner page and replica (replica uses its own banner; footer line still present).
- [ ] Hover/focus/active states on every interactive element (checked with `ecc:make-interfaces-feel-better`).
- [ ] Both visual identities verified: app screenshot vs replica screenshot must be obviously different at a glance.
- [ ] Dev-only: Playwright screenshots at four widths for each page stored in `.hackathon/shots/` for visual regression.
- [ ] Demo-critical: dashboard numbers equal 47 / $61,915.00 / CA 21 TX 15 DE 11 / $1,180.00 found; #10482 is $2,340.00 Bayline Electric; any total shown anywhere must reconcile to these.
