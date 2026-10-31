# Escheat Agent: redesign research (black / electric blue / a little pink)

Scope: research only, no repo changes. Evidence: all 24 screenshots reviewed (1440 and 375 in `scratchpad/theme/`), `src/app/globals.css`, `docs/DESIGN.md`, `package.json`, `layout.tsx`. npm facts checked live with `npm view` on 2026-10-31. Where a claim comes from memory rather than a fetched page, it is marked (mem).

---

## 1. Audit: the "vibe-coded" tells, ranked by impact

Ranked by how much each one contributes to the "AI template" read, with where it shows up.

1. **Five hues, not three, and amber is everywhere.** The brief is black, blue, pink. The UI is blue, pink, amber, green, red, sky, slate. Amber is the loudest color on the dashboard (bar chart, "Next deadline" pill, every date, "UNVERIFIED" on ~90% of rows, the whole Eval banner). Rainbow semantic color on a dark base is the single biggest template signal. Fix: strict 3-hue system, status via shape + weight (section 3).
2. **The "UNVERIFIED" dashed-outline pill is on almost every row and card.** It appears 6 times on the dashboard, once per row in Items (47 rows), once per timeline node in the drawer, once per field in Rules (32 of 32 rows). When 100% of things carry a warning, the warning carries no information, and the repeated dashed amber pills are the visual noise that makes the app look like a badge generator. Fix: state it once per page (a banner/status line), then mark only exceptions (verified rows get a mark) or use a tiny 6px glyph.
3. **One glowing hero card.** Dashboard "At risk today" has a blue glow border + radial gradient fill + gradient-glow shadow; login card is the same trick (glowing blue outline, gradient lock tile); Recoveries hero is a faint green-tinted gradient. Glow borders are the canonical "AI landing page" tell. Fix: no glow anywhere. Depth comes from 1px borders and 3 surface levels. If one thing is allowed to be loud, it is a solid blue fill, not a halo.
4. **Giant monospace hero numbers.** `$61,915.00` and `98.5%` and `$0.00` are in JetBrains Mono at 72px with a wide mono comma and period; mono makes the comma gap and the decimal cents the same visual weight as the dollars. Real fintech (Mercury, Ramp, Stripe) uses a proportional face with tabular figures, and visually demotes the cents. Fix: Geist (proportional, `tabular-nums`) at display size, cents at 50-60% size and text-3.
5. **Monospace overuse as "tech" decoration.** Dates (`Nov 1, 2026`), `in 1d`, `2.9y`, counts (`3 total`, `47 items`), state codes `CA`, `SYNTHETIC`, `PROTOTYPE`, `SYNTHETIC DATA`, rule paths, buttons' keyboard hints. Mono should mean "this is an identifier or code you may copy" (check #, rule path, JSON). Dates and counts are prose. Fix: mono only for check numbers, rule IDs, hashes, code blocks, kbd.
6. **Everything is a rounded card with the same border, radius and padding.** Dashboard has 5 same-radius bordered boxes, Items table sits in one, Eval has 6, Settings 3, Recoveries 2 stacked. No section is unboxed, so there is no hierarchy of containers; cards inside cards (CA/TX/DE tiles inside the hero card, "Exactly what will be sent" dashed box inside the approvals card). Fix: boxes only for things that are objects (the table, the letter preview, the drawer). Page-level grouping uses whitespace + a hairline + a section heading, not a box.
7. **Uppercase micro-labels with letter-spacing on every section** ("AT RISK TODAY", "BY OWNER STATE", "OWNER AND STATE", "TIMELINE", "SAFETY CHECKS", "ITEMS FULLY CORRECT", table headers) plus the `SYNTHETIC` / `PROTOTYPE` / `UNVERIFIED` caps pills. Caps tracking is used so much it stops functioning as a hierarchy signal. Fix: sentence-case 12-13px text-2 labels; caps only for table column headers at 11px or nowhere.
8. **Unclear primary action; buttons have no ranking.** Dashboard: "Open items" (blue pill, glowing) next to an UNVERIFIED pill that looks like a button. Approvals: "Approve" is a muted dark-blue disabled-looking button and "Send" is gray, so the page's one job reads as disabled. Reports: white "Generate report" while elsewhere primary is blue. Settings: "Suggest mapping" is a half-transparent blue button with a double ring. Three different primary styles across five pages. Fix: one primary (solid blue-600, white text), one secondary (outline), one ghost; max one primary per view; disabled state is visibly disabled and explains why.
9. **Wasted space and centered/orphan layout.** Reports, Recoveries, Runs, Settings put a card at the top and leave 60-70% of the viewport empty black. The empty-state card on Runs is a full-width box with left-aligned text hugging the left edge and a 400px-wide paragraph. Login is a small glowing card in a void. Fix: give empty states a layout (heading, one sentence, the next action, optional faint skeleton of what will appear), put list + detail side by side from the first state, and use the width.
10. **Pill soup in tables and filters.** Items rows have 3 chips per row (state code chip, shield chip, status pill) and an amber "in 1d" mono suffix; status column is a uniform grid of identical gray "Watching" pills (43 of 47 the same). Filter bar is 4 native `<select>`s with OS chevrons plus a ghost button, inconsistent with the rest of the system. Fix: status as a small dot/icon + text with no container for the common state, container only for the exceptional state; state as plain text `CA`; filters as chip-style popover triggers (Linear).
11. **Every number the same weight / no scale contrast in the body.** Aside from the one hero number, the Deadlines rows, Status rows ($2,347.84 and "2" in different gray weights), Audit-interest rows all use 13-14px at the same weight; amounts are not right-aligned consistently (Status card has amount and count in two unaligned columns). Fix: a real type scale, `font-weight: 500` for primary values, text-2 for secondary, right-aligned tabular amounts.
12. **Dashed outlines as a default container** (Approvals "exactly what will be sent", Settings "Not configured" notes, "+ Draft email" chips). Dashed = placeholder in Figma; here it reads as unfinished. Fix: dashed only for drop zones / true "add" targets.
13. **Gradient brand tile and gradient sidebar active item.** Logo is a blue-to-pink gradient rounded square with a bolt; active nav has a blue glow fill and left rail. Lightning-bolt-in-gradient-tile is a stock AI-product logo. Fix: a wordmark-first, flat blue mark; active nav = text-1 + subtle ink-3 fill, no color.
14. **Chrome overload in the top bar.** Company switcher + SYNTHETIC chip + search + "Demo date" pill + PROTOTYPE pill; footer repeats "Prototype. Not legal advice" + SYNTHETIC DATA chip on every page. Fix: one slim "demo environment" strip (or one status chip), the date control becomes a menu in the user area, the legal line lives in the footer only on login/marketing/report pages and in the sidebar bottom as a single muted line.
15. **Dead "Chat" nav item with no icon identity, 9 nav items of equal weight, Settings/Sign out as plain text of different alignment than other nav.** Group nav (Work: Dashboard, Items, Approvals; Setup: Rules, Reports, Recoveries; System: Agent runs, Eval, Chat) and put counts on the ones that matter (Approvals 2).
16. **Mobile (375): sidebar collapses to hamburger but dashboard hero stacks into a 540px-tall scroll of identical cards; deadline rows wrap to 4-line titles with the amount squeezed.** Fix: horizontal-scroll stat strip, rows with 2 lines max, table becomes a list with amount right-aligned.
17. **Tables:** Items uses a sticky height-capped box that cuts a row mid-line at the bottom (see "#10258" row clipped under the footer), a "j k move · ↵ open" hint at the top right in small gray, no row hover/selection visual in the screenshot, and a Rules page with 90+ identical rows with an "Approve" button on each (32 buttons) and 5 lines of TODO prose in the Value cell. Fix: group Rules by type with collapsible sections, one bulk action, a side-panel for rule detail; keep table rows to one line and move TODO notes into a popover/drawer.
18. **Eval page uses red/green text for expected/got values and gray + blue bars at equal weight.** Fix: expected = text-1, got = pink with a strikethrough relationship; bars in blue (generated) vs outline blue (adversarial).

What is already fine and should be kept: dark-first; the left rail + top bar shell structure; `tabular-nums` globally; `cmdk` palette; `j/k` keys; the master-detail Approvals layout; the info architecture (the product thinking is good, the skin is the problem).

---

## 2. References: what top-tier products do instead, and the principles to take

Sources fetched this session: Linear redesign post, Vercel Geist color docs, 21st.dev and dev.to "AI-generated look" posts, GSAP license page. Product behavior from memory is marked (mem).

### 2.1 "Why it looks AI generated" (current articles)
- dev.to (alanwest): tells are `rounded-2xl shadow-lg p-6` on everything, Inter + bold headings, indigo CTA, centered hero + three icon cards, generic "Empower/Unlock/Transform" copy. Fixes that apply directly: replace the Tailwind palette rather than extend it, remove radius+shadow and use borders/left accents, define a small set of card variants and one radius vocabulary, asymmetric grid hero, optional ESLint rule banning class patterns.
- 21st.dev: the strongest tell is generic copy; fix with one concrete claim ("$61,915 across 47 checks, 3 due in 2 days"); break the grid with one deliberately larger cell; real screenshots over illustrations; neutrals derived from the base color; "cover the logo test".
- Towards-AI / saasui / producthunt threads (search results, not fetched in full): consistent list: purple-blue gradients, glow, emoji icons, same card grid, "dashboard for everything".
- Common conclusion: decide system first (type scale, spacing, radius, one priority per screen, real content), then style. Our app already has real, specific content; the fix is system discipline.

### 2.2 Per-product takeaways
- **Linear** (fetched): Inter Display for headings, Inter for text; LCH-based theme from 3 inputs (base, accent, contrast) instead of 98 variables; reduced accent use so neutrals read as timeless; removed chrome color; increased density and hierarchy in navigation; obsessive alignment of icons/labels/buttons. Take: neutral-first, 1 accent, display cut for headings, 32px rows, 13px text, icons 16px at 1.5 stroke, status icons are shapes.
- **Vercel / Geist** (fetched): each color scale is 10 steps with fixed roles: 100 bg, 200 hover bg, 300 active bg, 400 border, 500 hover border, 600 active border, 700 solid, 800 hover solid, 900 secondary text, 1000 primary text. Take this exact role map for our blue and pink scales so every token has one job. (mem) Geist tables: 40px rows, text 14px, borders 1px gray-alpha, no card shadows in dark mode, buttons 32/40px, 6px radius, "ring" focus.
- **Resend** (mem): near-black (#000) background, white text, one gradient used sparingly on the hero only, big display type with tight negative tracking (-0.03em), mono used only for code samples, subtle 1px borders with a 5-8% white alpha, logos in grayscale. Take: pure black ground + hairlines + large tight type = premium.
- **Raycast** (mem): dark with a rare accent, keyboard-key visuals (kbd chips are the decorative element), large product screenshot as the hero with soft perspective, fine grain/noise, small tasteful animations. Take: kbd chips as a design motif (we already have j/k).
- **Clerk** (mem): clean grid backgrounds, product UI components shown live inside marketing page, purple accent used only for primary; tight docs-like typography.
- **Mercury** (mem): balance as the hero in a proportional serif/sans display with the cents lighter; quiet sparkline; transactions as a list with a single right-aligned amount and a status dot; very low color; large whitespace.
- **Ramp** (mem): "needs your review" queue first; one accent; dense table with one bold amount column; clear primary CTA; illustrations replaced by product UI. DESIGN.md already captured the approval-queue lesson.
- **Stripe Dashboard** (mem + the DESIGN.md note): quiet gray surfaces, 1px borders, almost no shadow, side drawer for object details, timelines with a rail, copy buttons on IDs, restrained color; status badges are small, sentence-case, two-tone (tinted bg, same-hue text) and appear only on the status column.
- **Arc / The Browser Company** (mem): playful but only in marketing; app chrome is monochrome with rounded blocks. Skip for app; borrow nothing except spring physics for the sidebar.

### 2.3 Principles extracted (applicable)
**Typography scale (app):** 12 / 13 / 14 / 16 / 20 / 28 / 44-56 hero. Body is 13px in tables, 14px in forms and prose. Only 2 weights in the app (400 and 500, with 600 for the page title). Tracking: -0.01em at 20px+, -0.03em at hero. Line-height 1.5 body, 1.15 display. Numbers: always `tabular-nums`, right-aligned in tables, 500 weight for primary value, text-2 for secondary.

**Density:** rows 36px (comfortable) with a 32px compact toggle; page max-width 1280px content, 24px page padding, 8px grid; section gap 32-48px; card padding 16px; the sidebar 232px, 13px items at 32px height.

**Borders vs shadows (dark UI):** no drop shadows on cards; use `1px` borders at `rgb(255 255 255 / 0.08)` (hover 0.14). Elevation = lighter surface, not shadow. Only overlays (popover, dialog, drawer, toast) get a shadow: `0 16px 48px -8px rgb(0 0 0 / .6)` plus a 1px border. One radius vocabulary: 6px controls, 10px containers, 999px only for chips that need it, and tables 0 inner radius.

**Color restraint:** 90% neutrals; blue only for interactive + selected + hero data series; pink only for "attention" semantics and one decorative accent per marketing screen. Large areas of blue or pink fill are banned in the app (at most 1 solid blue button per view).

**Motion:** 120-240ms for UI state, 300-420ms for panels, 600-900ms for number tweens, ease-out family, no bounce on data UI, springs only on drawers and layout. Never animate on first paint what the user already needs to read (table rows do not stagger on every navigation). Respect `prefers-reduced-motion`. Full spec in section 7.

**Data tables:** single-line rows, left-align text, right-align numbers, sticky header with a bottom hairline, row hover = ink-2 fill, selected = 2px blue left rail + ink-3 fill, column header = 12px text-3 sentence case with a small sort caret that appears on hover, tabs for saved views with counts, filter chips with `+ Filter`, empty/zero results with a clear-filters action, never a clipped row at the container edge (use full-page scrolling table with sticky header).

**Empty states:** a heading that states the fact ("No agent runs yet"), one sentence about what will appear and why, one primary action, and a ghosted skeleton of the future content at 30% opacity so the page keeps its structure. No illustrations, no centered void.

---

## 3. Palette (strict: black, electric blue, pink, plus white/gray neutrals)

Neutrals are blue-tinted by about 2% (so grays belong to the blue family), which is why this stays a 3-hue system: black, blue, pink. "White" and "gray" are tints of black, not hues.

### 3.1 Tokens

**Backgrounds (4 levels)**
| Token | Hex | Use |
|---|---|---|
| `ink-0` | `#000000` | page background, login, marketing |
| `ink-1` | `#07080B` | sidebar, top bar |
| `ink-2` | `#0D0F14` | cards/table container, input wells |
| `ink-3` | `#151821` | hover rows, popovers, drawers, selected nav |

**Text (3 levels + decorative)**
| Token | Hex | Use |
|---|---|---|
| `text-1` | `#F4F6FA` | headings, primary values |
| `text-2` | `#A6ADBD` | body secondary, labels |
| `text-3` | `#8089A0` | metadata, placeholders, timestamps |
| `text-4` | `#4A5164` | decoration only (dividers' glyphs, disabled icons), never for readable text |

**Borders:** `border` `rgb(255 255 255 / 0.08)`; `border-hover` `rgb(255 255 255 / 0.14)`; `border-strong` `rgb(255 255 255 / 0.22)`; focus ring 2px `blue-400` with 2px `ink-0` offset.

**Electric blue scale (Geist-style 10 roles, 7 stops needed)**
| Stop | Hex | Role |
|---|---|---|
| `blue-900` | `#0A1535` | tinted bg (selected row wash, info banner) |
| `blue-800` | `#10236B` | hover tinted bg, chart area fill at 40% |
| `blue-700` | `#1747D6` | pressed solid, borders on tinted bg |
| `blue-600` | `#1F5BFF` | **primary solid** (button fill, switch on), white text on it |
| `blue-500` | `#3D7BFF` | chart series, focus accents, rail, icons, large text >=18px or bold 14px |
| `blue-400` | `#6E9BFF` | links, small text on dark, focus ring |
| `blue-300` | `#9DBBFF` | text on blue-900 tint, hover link |

**Pink scale**
| Stop | Hex | Role |
|---|---|---|
| `pink-900` | `#3A0A22` | tinted bg for attention banner/row |
| `pink-700` | `#8F1458` | border on tint |
| `pink-600` | `#E01F86` | solid for large non-text (progress, bars) |
| `pink-500` | `#FF4DA6` | **attention solid** (small pill fill with black text, dots, numbers of urgency) |
| `pink-400` | `#FF7FC0` | text on dark, hover |
| `pink-300` | `#FFB3D6` | text on pink-900 tint |

### 3.2 Contrast table (WCAG ratio; need >=4.5 for text, >=3 for non-text/large)

Text on backgrounds (ink-0 / ink-1 / ink-2 / ink-3):
| Foreground | ink-0 | ink-1 | ink-2 | ink-3 | Verdict |
|---|---|---|---|---|---|
| text-1 `#F4F6FA` | 19.41 | 18.51 | 17.72 | 16.39 | pass |
| text-2 `#A6ADBD` | 9.33 | 8.90 | 8.52 | 7.88 | pass |
| text-3 `#8089A0` | 6.00 | 5.73 | 5.48 | 5.07 | pass (min 5.07) |
| text-4 `#4A5164` | 2.65 | 2.53 | 2.42 | 2.24 | decoration only, fails by design |
| blue-300 `#9DBBFF` | 10.99 | 10.48 | 10.03 | 9.27 | pass |
| blue-400 `#6E9BFF` | 7.80 | 7.43 | 7.12 | 6.58 | pass |
| blue-500 `#3D7BFF` | 5.48 | 5.22 | 5.00 | 4.62 | pass (all four) |
| blue-600 `#1F5BFF` | 4.00 | 3.81 | 3.65 | 3.38 | **fails as text**; use only as fill and for non-text UI (>=3) |
| pink-300 `#FFB3D6` | 12.67 | 12.08 | 11.57 | 10.70 | pass |
| pink-400 `#FF7FC0` | 9.05 | 8.63 | 8.26 | 7.64 | pass |
| pink-500 `#FF4DA6` | 6.86 | 6.55 | 6.27 | 5.80 | pass |
| pink-600 `#E01F86` | 4.71 | 4.49 | 4.30 | 3.98 | text only on ink-0; otherwise non-text |

Filled components:
| Pair | Ratio | Verdict |
|---|---|---|
| white `#FFFFFF` on blue-600 `#1F5BFF` (primary button) | 5.25 | pass |
| white on blue-700 `#1747D6` (button pressed) | 7.22 | pass |
| black `#000000` on pink-500 `#FF4DA6` (attention pill) | 6.86 | pass |
| black on blue-400 `#6E9BFF` | 7.80 | pass (alt light-blue chip) |
| text-1 on blue-900 `#0B1A4D` | 15.29 | pass |
| blue-300 on `#0A1535` | 9.38 | pass |
| pink-300 on pink-900 `#3A0A22` | 10.17 | pass |
| pink-400 on pink-900 `#3A0A22` | 7.26 | pass |

Rule of thumb that falls out: blue small text uses `blue-400`/`blue-300`, never blue-600. Interactive fills use blue-600 with white text. Pink small text uses `pink-400`; pink fills use black text.

Ratios computed with the WCAG 2.x relative luminance formula (script in scratchpad `cr2.py`).

### 3.3 Status without other hues

Principle: status is carried by **shape/icon + label + fill vs outline vs plain + weight**; color only reinforces. Every status has a text label; no status is color-only.

| Status | Visual | Spec |
|---|---|---|
| **Resolved** | Solid blue check | 14px filled-circle check icon `blue-500`, label "Resolved" `text-2`; no container. In a chart: solid blue-500. Row text stays text-2 (it is done, it recedes). |
| **At risk / due soon / awaiting you** | Pink, filled, the loudest thing on screen | Pill: `pink-500` fill, black text 12px/500, clock icon, e.g. `Due in 1d`. Dot variant `pink-500` 6px + text-1 label in dense cells. Pink is only for "needs human attention in the near term". Money at risk in the hero uses text-1 with a pink underline/sparkline, not pink digits. |
| **Unverified** (very common) | White/gray outline, dashed removed | Do not repeat per row. Page banner once: `blue-900` tint, blue-300 text, info icon "Rule values are unverified; dates are provisional." Per-row: 12px `shield-question` icon in `text-3` with tooltip (no pill). Unverified-only exceptions get emphasis, i.e. show a `Verified` checkmark (blue) on the few verified rows instead. |
| **Unknown** | Hollow, em dash | `text-3` italic "Unknown" or "-" with a hollow 8px ring; tooltip says why ("no rule value"). Never a number substituted. |
| **Error / failed / blocked** | Pink outline + alert icon + sentence | 1px `pink-500` border, `pink-900` tint bg, triangle-alert icon `pink-400`, text-1 message, plus a "Retry" ghost button. Distinguished from "at risk" by being an outlined, tinted block with a message instead of a small filled pill. Failures in lists: pink x-octagon icon + "Failed". |
| **Neutral / watching / draft / info** | Plain text, no container | `text-2`, 14px icon in text-3 (eye, file). Draft = "Draft" in text-2 with dotted-circle icon. Most-common state gets no chip so the exceptions pop (fixes 43-identical-pill problem). |
| **In progress / running** | Blue outline + animated ring | `blue-500` 1px ring spinner / a pulsing blue dot (opacity only), label "Running". |
| **Selected / active** | Blue rail | 2px `blue-500` left rail + `ink-3` fill, text-1. |

Charts: series 1 `blue-500`, series 2 `blue-300` (lighter blue, not a new hue), series 3 `text-3`, highlight series `pink-500` only to flag the one at-risk datum. Stacked bars for CA/TX/DE: blue-500 / blue-300 / white at 55% opacity (distinguish by lightness, and always label directly, never rely on legend color). Alternate fills with pattern (hatch) for the third series for accessibility.

---

## 4. Typography

**Recommendation: Geist + Geist Mono for the app; Instrument Serif (italic accent words only) added on the marketing page.** All three are on `next/font/google` (`Geist`, `Geist_Mono`, `Instrument_Serif`). Max two families in the app, three on the landing page (matches the rule file's limit with a clear exception).

Why:
- **Geist** is a neutral grotesk tuned for UI with real tabular figures and a variable weight axis; it keeps our dense table text crisp at 13px, and its geometry harmonizes with black/electric-blue (Vercel/Resend aesthetic). Honest caveat: Geist is the `create-next-app` default and so appears in AI-generated sites; the tell is the combination (default radius, gradient, glow) rather than the face, and we offset it with tight tracking, a real scale, and the Instrument Serif accent. If you want zero default-risk, the substitute is **Inter Tight** (Linear-like "display" feel) for headings with Inter body; it is less distinctive but has the same dense-table quality.
- **Geist Mono** only for check numbers, rule IDs, hashes, code, kbd. Replaces JetBrains Mono (which at hero scale is the "terminal-themed AI dashboard" look).
- **Instrument Serif** (marketing headlines only): one italic word per headline ("The state wants *its* money. You want proof."). It gives the otherwise-technical page a human editorial signature, solves "generic type", and is single-weight so it costs ~20KB.

Setup (next/font, variable fonts, `display: swap`):
```ts
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
const sans = Geist({ variable: "--font-sans", subsets: ["latin"], display: "swap" });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"], display: "swap" });
const serif = Instrument_Serif({ variable: "--font-serif", weight: "400", style: ["normal","italic"], subsets: ["latin"], display: "swap" }); // marketing layout only
```
Enable `font-feature-settings: "tnum", "ss01"` only where needed; do not apply `tnum` globally to prose (it makes text look mechanical). Apply `font-variant-numeric: tabular-nums` to `.num` utility and table cells.

**Type scale (app)**
| Token | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| `text-xs` | 12 / 16 | 400/500 | +0.01em | labels, table headers, metadata |
| `text-sm` | 13 / 20 | 400/500 | 0 | table cells, nav, dense UI |
| `text-base` | 14 / 22 | 400 | 0 | body, forms |
| `text-md` | 16 / 24 | 500 | -0.005em | card titles |
| `text-lg` | 20 / 28 | 600 | -0.015em | page title |
| `text-xl` | 28 / 34 | 600 | -0.02em | section heroes |
| `display` | 48-56 / 1.05 | 500 | -0.035em | the one exposure number (cents at 0.5em, text-3) |

**Marketing scale:** h1 `clamp(2.75rem, 1.5rem + 5vw, 5.5rem)` / 1.02 / -0.04em (Geist 500, with one Instrument Serif italic word at 1.08em); h2 `clamp(2rem, 1.4rem + 2.4vw, 3.5rem)` / 1.08; lead 18-20 / 1.5 text-2; eyebrow 13px text-3 sentence case (no caps).

---

## 5. Libraries (versions verified with `npm view` on 2026-10-31)

| Library | Version | License | React 19 / Next 16 | Size | Verdict |
|---|---|---|---|---|---|
| `motion` | 14.9.0 (installed ^14.7.1) | MIT | peer `^18 || ^19`, fine | unpacked 938KB; with `LazyMotion` + `domAnimation` ~5KB gz initial (mem) | **Keep. Main app animation lib.** Use `motion/react`, `m` components, `useScroll`/`useInView` for landing reveals. |
| `@number-flow/react` | 0.6.2 (installed) | MIT | peer `^18 || ^19` | unpacked 25KB, ~8KB gz (mem) | **Keep.** Exposure number, KPI counters, eval %. Already used. Pin exact because 0.x. |
| `lenis` | 1.3.27 | MIT | peer `>=17`; client-only | unpacked 458KB; site says under 5KB gz | **Add, marketing page only** (not the app shell; app tables/drawers have their own scroll containers and smooth-scroll hijacking hurts data UIs). Mount in marketing layout only, disable under `prefers-reduced-motion`. |
| `gsap` + `@gsap/react` | 3.15.0 / 2.1.2 | GSAP "Standard no charge" license (not OSI) | `@gsap/react` peer `>=17`, `useGSAP` hook is SSR-safe | gsap core ~27KB gz + ScrollTrigger ~12KB gz (mem); unpacked 6.2MB incl. all plugins | **Optional, marketing only, dynamic import.** Verified on gsap.com/standard-license: all of GSAP including the formerly members-only plugins (ScrollTrigger, SplitText, MorphSVG) is free for commercial use. Restriction: you may not use it in a tool that competes with Webflow's visual animation builder; cannot strip notices. We are fine. Only add if the landing page needs pinned scrollytelling / SplitText; otherwise motion's `useScroll` covers 90%. |
| `recharts` | 3.10.1 (installed) | MIT | peer includes 19 | ~90KB gz total, tree-shakeable (mem) | **Keep, restyle** with CSS-var colors, no gridlines on bars, custom tooltip. shadcn `chart` wrapper is already the pattern. |
| `@tremor/react` | 3.18.7 | Apache-2.0 | **peer `react ^18` only** | heavy, drags own Tailwind plugin | **Avoid.** React 19 incompat (peer), and its defaults are the template look. |
| `@visx/visx` | 4.0.0 | MIT | peer `^18 || ^19` | modular (~per-package) | Skip unless a bespoke chart is needed (deadline timeline). Recharts + custom SVG is enough. |
| `geist` (npm font pkg) | 1.9.0 | OFL | peer `next >=13.2` | self-hosted | Not needed; use `next/font/google` for the same fonts. |
| `@phosphor-icons/react` | 2.1.10 | MIT | peer `>=16.8` | tree-shakeable | **Skip.** Mixing Phosphor + lucide is an inconsistency tell. |
| `lucide-react` | 1.66.0 (installed ^1.63) | ISC | peer includes 19 | tree-shakeable | **Keep.** Standardize: 16px, `strokeWidth={1.5}`, `text-3` default color, no icon-in-colored-circle tiles. |
| Magic UI / Origin UI / 21st.dev / React Bits / Aceternity | copy-paste, no runtime dep (React Bits also ships an npm package, `react-bits@1.0.5`; not needed) | MIT (mem; check each component) | copy-paste, you own the code | 0 runtime | **Use selectively as source for 4-6 pieces, restyled to tokens**: see below. |

**Component sources, what to take and what to avoid**
- Take (mem, verify license on copy): Magic UI `number-ticker` is redundant with NumberFlow (skip); Magic UI `marquee` (landing logo strip), `dot-pattern`/`grid-pattern` (landing background), `blur-fade` (in-view reveals: really just motion `whileInView`, write your own in 15 lines), `animated-beam` (diagram for "agent connects QuickBooks/Plaid to states" on landing), `bento-grid` anatomy. Origin UI / coss and shadcn `base-nova` primitives for table, tabs, command, combobox, filter chips (our base is `@base-ui/react`, matches). 21st.dev: search with the installed `21st-cli-use` skill for a Linear-style filter bar, a stat block and a timeline, then re-token them. React Bits: only for one text effect on landing if wanted (e.g. SplitText-like reveal), otherwise skip.
- Avoid: Aceternity UI's spotlight cards, glowing beams, "3D card" and meteor effects (they are the vibe-coded look), Magic UI `border-beam`, `shine-border`, `neon-gradient-card`, `particles`, `retro-grid`, `ripple`. These are the exact glow-border/gradient-orb patterns in the audit.

**Minimal set that gives the biggest lift** (net-new deps: 1 required, 2 optional):
1. `next/font/google` Geist + Geist Mono (no dep) - biggest typographic lift.
2. `motion` (have) + `@number-flow/react` (have) - app motion.
3. `lenis` - marketing smooth scroll (new, small).
4. `gsap` + `@gsap/react` - optional, only if the landing needs pinned scrollytelling/SplitText.
Everything else is CSS tokens and restyling existing shadcn/base-ui + recharts + cmdk + sonner + nuqs + tanstack-table (already installed).

---

## 6. Plan: per-screen redesign

### 6.0 Global system (do first, one PR)
- Replace tokens in `globals.css`: new `--ink-0..3`, `--text-1..4`, `--blue-*`, `--pink-*`, remove `--es-amber/green/red/sky/slate`, remove glow vars, `.es-glow`, `.es-gradient-*`, `.es-agent`. Map shadcn vars: `--primary: blue-600` (fg white), `--ring: blue-400`, `--destructive: pink-500` (fg black), `--chart-1..5: blue-500, blue-300, text-3, pink-500, text-4`. Radius `--radius: 10px` with controls at 6px.
- Components: `Button` (primary solid blue-600, secondary 1px border + ink-2, ghost, destructive = pink outline; 32px height default; focus ring); `Badge` replaced by `StatusLabel` (plain/dot/pill variants per section 3.3); `Card` becomes `Panel` (border only, no shadow, 10px radius, no inner highlight); `Table` v2 (sticky header, 36px rows, selection rail); `PageHeader` (title 20px/600, one-line description text-2, actions right); `EmptyState` (per section 2.3); `Kbd`; `Num` component wrapping NumberFlow with cents-dim formatting.
- Page template: `max-w-[1280px]`, `px-6`, sections separated by `border-t border-border pt-8` instead of boxes.
- Lint guard: ESLint `no-restricted-syntax` / grep CI check banning `amber|green|red|emerald|sky|indigo|purple|shadow-(md|lg|xl)|rounded-(2xl|3xl)|drop-shadow|ring-offset` in `src`.

### 6.1 Shell / sidebar
- Sidebar 232px, ink-1, 1px right border. Top: wordmark "Escheat" (Geist 600, flat `blue-500` mark, no gradient tile). Nav groups with 11px text-3 group labels in sentence case: **Work** (Dashboard, Items, Approvals [count 2 as small pink-500 number if >0]), **Setup** (Rules, Reports, Recoveries), **Agents** (Agent runs, Chat, Eval). Active: ink-3 fill + text-1, icon blue-400, no rail glow. Bottom: company switcher (moved from top bar), Settings, user menu (sign out, demo date control here).
- Top bar removed from most pages; keep a 48px slim bar only for page breadcrumb + search trigger (`Cmd K` kbd) + a single environment chip "Demo data" (text-2, outline). Drop "PROTOTYPE" pill; keep the legal line once in the sidebar bottom as 11px text-3.
- Mobile: bottom-sheet nav from hamburger; same groups.
- Motion: sidebar active indicator slides between items with `layoutId` (spring 420/40); nothing else.

### 6.2 Dashboard
- Header row: "Good afternoon" is not needed; title "Dashboard", sub "Northwind Fixtures, Inc. · as of Oct 31, 2026".
- Hero (no card, no glow): left, display `$61,915` + `.00` dim, label "At risk today" text-2 above, "47 stale items across 3 states" below; right, a one-line stacked bar CA / TX / DE (blue-500 / blue-300 / white-55%) with directly labeled amounts underneath, no tiles. Primary action: solid blue "Review items" button, secondary text link "View timeline". Below, a single full-width banner (blue-900 tint) for "Rule values are unverified" with a link to Rules, replacing the 6 pills.
- Row 2 two columns, unboxed with hairline above: **Next deadlines** (list, 3 rows: date column 56px text-3, title text-1/500, state text-3, amount right-aligned tabular, relative "in 1d" as pink-500 pill only when <=7d) and **Needs you** (Approvals count with a primary link: "2 drafts awaiting approval" and the status breakdown To report / DD due / Watching as 3 compact rows with counts; "Watching" is plain text).
- Row 3: Deadline chart (90 days, bars in blue-500, within-14-days bars `pink-500`, no legend box: inline annotation "3 due in the next 14 days") and **Featured item** reduced to a "Next up" row, not a separate card; audit exposure becomes a 3-row table with "Unknown" in text-3 and one explanatory sentence.
- Motion: NumberFlow count 700ms on mount (once per session, skip on revisit); stacked bar segments grow `scaleX` 500ms ease-out-expo, staggered 60ms; list rows fade/translateY(6px) 240ms stagger 30ms only first mount.

### 6.3 Items table + drawer
- Header: title, "47 items · $61,915.00" text-2, saved-view tabs: All 47 / Needs action 4 / Due in 90d 3. Filter bar: `+ Filter` chip trigger opening a command-style popover (State, Status, Type, Age), active filters as removable chips; search is the leftmost 240px input. Remove native selects. URL state via nuqs (already installed).
- Table columns (1 line each): Check # (mono), Payee (text-1/500), State (plain text, text-2), Amount (right, tabular, 500), Type (text-2), Issued (text-3), Next deadline (date + relative, pink-500 text only when due soon), Status (dot + label, plain for Watching, pink pill only for DD due / To report). Unverified shown as a 12px glyph beside the date with tooltip.
- Row hover ink-2, selected row ink-3 + 2px blue-500 rail; keyboard j/k/enter retained; page scrolls with a sticky header; footer summary bar sticks to the bottom (sum of filtered).
- Drawer (480px, ink-3, 1px border-left, shadow only here): header with `#10482` mono + payee, status label, amount; **primary action at the top-right** ("Mark resolved" as secondary, since resolving is rare; the primary is "Open in approvals" when a draft exists). Sections separated by hairlines, not boxes: Owner and state, Timeline (vertical 1px rail; past nodes solid blue-500 dots, next node pink-500 ring, future hollow text-4; date text-3, rule version mono, source chips as plain text links with an icon), Activity. Remove per-node UNVERIFIED pills; one banner at the top of the timeline.
- Motion: drawer slides from right with spring (stiffness 420, damping 38, ~320ms), scrim fades 200ms to rgb(0 0 0 / .5); timeline nodes fade in 160ms stagger 40ms; row selection rail animates `scaleY` 120ms.

### 6.4 Approvals
- Keep master-detail; make the list a flat list (no inner cards): row = icon, title, payee, amount, due. Selected = rail. Tabs "All / Letters / Emails" as underline tabs.
- Detail: header with title + amount; "What will happen" paragraph; **Preview** is a real paper-like document panel (an ink-2 panel with a letter facsimile in text-1 inside a bordered frame, staying inside the palette) with "Compose" as the primary action if not composed; Safety checks as a 2-column checklist with blue check / text-3 info icons (no green); sticky footer bar with a single primary "Approve and send" (solid blue-600), "Reject" secondary with required reason popover. Disabled state: text-3 with helper "Compose the letter first". Reviewer identity as a small avatar chip not a bordered input.
- Motion: on approve, the list row collapses (height via `layout`, 240ms) and a sonner toast with Undo (5s) slides in; the detail cross-fades 160ms to the next item.

### 6.5 Rules
- Group by property type with collapsible sections (Vendor check, Payroll check, Customer credit, Unapplied cash, Due diligence, Report stages, Remittance, Interest, Format). State tabs CA/DE/TX as underline tabs with `n / 32 verified` text-3 (not pills).
- Row: Field (text-2), Value (text-1/500, mono only if a code), Sources (up to 2 text-link chips collapsed to "2 sources"), Status (verified blue check vs "Unverified" text-3), row action "Review" ghost button on hover only. TODO prose moves to a drawer opened by clicking the row. One bulk "Approve all with a value (32)" primary at the top with confirmation dialog.
- Version history becomes a slim table at the bottom. Motion: section collapse 200ms height + opacity; drawer same as items.

### 6.6 Reports
- Left list of states becomes top segmented tabs CA / DE / TX with counts "1 to report". Main area: header + a 4-metric strip (To report, Amount, Status, Generated) as plain stats separated by hairlines (not tiles), a primary "Generate report" button (solid blue), and below a vertical stepper: Generate, Validate, Approve, File with per-step status labels. Wide layout, the unused vertical space holds a ghosted preview of the NAUPA file validation results (empty-state skeleton).
- Motion: stepper line fills with `scaleY` 400ms as steps complete; validation results stagger in.

### 6.7 Recoveries
- Hero: "Found for Northwind Fixtures, Inc." with `$0` in display (text-3 when zero, blue-400 when >0), "Run recovery search" primary on the right of the same line. Below: a 3-column portal status strip (CA / DE / TX portals: last searched, matches) and a results table (portal, matched name variant, confidence as a thin blue bar + number, claim action). Empty state shows the table skeleton with explanatory sentence, not a separate card.
- Motion: during search, a determinate progress line (blue) per portal with step text; results rows stagger in 200ms.

### 6.8 Agent runs
- Table of runs (time, agent, task, steps, duration, cost, status) with a status dot (blue pulse running, blue check done, pink x failed); empty state with skeleton rows. Run detail page: trace viewer (Vercel build-log style): collapsible steps with a left rail, per-step duration right-aligned, tool input/output JSON in `ink-2` code well with Geist Mono 12px, citation chips as text links, header summary (total tokens, cost, duration) as stat strip.
- Motion: step expand 200ms height; live runs append new steps with 160ms fade; copy buttons flash a blue check 1s.

### 6.9 Eval
- Replace the amber banner with a neutral blue-900 info banner ("Heuristic baseline: no Anthropic key was configured; do not read as model accuracy"). Hero stat row (98.5% in display with NumberFlow, then Generated 100.0%, Adversarial 92.5%, Run date) as a hairline-separated strip. Charts: horizontal bars, thin (6px) track ink-3 with blue-500 fill (generated) and outlined/hatched blue (adversarial); labels left, value right; no per-row mono counts (put them in tooltip). Misses table: Expected in text-1, Got in pink-400, case id mono. Run details as a definition list in two columns; command snippet in a code well with a copy button.
- Motion: bars grow 600ms ease-out-expo stagger 50ms on mount; numbers tween 700ms.

### 6.10 Settings / Integrations
- Rows, not cards: each integration is a row (logo-less name, one-line description, status text "Not configured" text-3, "Configure" secondary button that opens a drawer with the env var instructions in a code well). CSV upload becomes a drop zone (the only dashed border in the app) + mapping step. Primary action: only "Suggest mapping" after a file is chosen.
- Motion: file chosen -> drop zone collapses to a file row 200ms.

### 6.11 Login
- Split layout at >=1024px: left 50% ink-0 with the wordmark, one-line product statement, a quiet live-looking static preview of the exposure number; right 50% ink-1 with a 360px form (no card border), field + solid blue "Enter" button, legal line at the bottom. No glow, no gradient tile, no lock icon in a colored square. Mobile: single column.
- Motion: form fades up 240ms; error shakes 2px x 3 cycles (transform) 240ms plus pink border.

### 6.12 Not found
- Large `404` display in text-4, sentence "That page does not exist", primary "Back to dashboard". Left-aligned, not centered.

### 6.13 Marketing landing page (new `(marketing)` route group, Lenis + motion, GSAP optional)
Direction: "ledger at night": pure black, Resend-like restraint, big tight type, one Instrument Serif italic word, one electric blue moment, one pink moment.
1. **Nav**: wordmark left, 4 links, "Sign in" ghost + "Book a demo" solid blue. Sticky, blur on scroll.
2. **Hero (asymmetric, not centered):** left column h1 "Unclaimed property, filed *on time.*" (Geist 500, serif italic on the last two words), lead 2 lines, two actions (solid blue "Book a demo", text link "See how it works"). Right column bleeds off the viewport edge: a real product screenshot of the dashboard exposure + deadlines, in a 1px bordered frame with a soft perspective tilt (CSS 3D, 4deg) and a masked bottom fade. A live NumberFlow `$61,915` cycles once on load. Background: dot grid at 4% white. Single blue radial at 8% opacity behind the screenshot only (the lone "glow", subtle).
3. **Proof strip:** one concrete claim line with numbers ("47 stale checks found in 11 minutes. 3 filings due in 48 hours.") plus customer logos only if real (otherwise omit).
4. **How it works (scrollytelling):** pinned left text that changes step 1-4 (Ingest ledger, Classify with citations, Draft letters you approve, File to state portals) while right visual swaps between four real UI panels; driven by motion `useScroll` or GSAP ScrollTrigger pin. Mobile: stacked.
5. **Bento (uneven, 1 large cell):** large cell "Every date cites its rule" with the drawer timeline; small cells: Approval queue, Audit trail, Recoveries, Keyboard-first (kbd chips j k enter). Pink used only on the one "due in 1d" pill inside a screenshot.
6. **Trust section:** "Nothing is sent without you": the approval screen with the safety checklist; honest limits (synthetic data, human verification of rule values) in plain language.
7. **Pricing or CTA:** one big line "See your exposure in an afternoon" + blue button; footer with legal disclaimer (not legal advice).
- Motion: Lenis `lerp 0.1`, `autoRaf`; section reveals = opacity 0->1 + translateY 16px, 700ms ease-out-expo, `once`, stagger 80ms children; hero h1 word-by-word reveal 600ms stagger 40ms (SplitText if GSAP, otherwise a 20-line manual split); screenshot parallax max 24px; nothing loops except the one NumberFlow tick; all disabled under reduced motion (Lenis `autoRaf=false`).

---

## 7. Motion spec

**Tokens**
```css
--ease-out:      cubic-bezier(0.25, 1, 0.5, 1);   /* default UI, ease-out-quart */
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);   /* big entrances, bars, reveals */
--ease-in-out:   cubic-bezier(0.65, 0, 0.35, 1);  /* layout shifts, collapses */
--dur-instant: 90ms;  --dur-fast: 150ms;  --dur-base: 240ms;  --dur-slow: 400ms;  --dur-num: 700ms;
/* springs (motion): */
sheet:  { type: "spring", stiffness: 420, damping: 38, mass: 1 }   /* drawers/dialogs, ~300ms */
layout: { type: "spring", stiffness: 500, damping: 40 }            /* nav indicator, list reorder */
```
**What animates**
- Hover/press/focus of controls: 90-150ms, `background-color`, `border-color`, `color`, `opacity`; press `transform: scale(0.98)`. List the properties; never `transition: all`.
- Drawer, dialog, popover: sheet spring or 160-200ms scale 0.98 + fade for popovers; scrim 200ms.
- Page transitions: none for route changes in the app (instant). Only the content region fades 120ms on tab/segment change. (No staggered table rows on every navigation.)
- First-mount only (per session): exposure number tween 700ms (NumberFlow), bars grow 500-600ms ease-out-expo, list fade-in 240ms stagger 30ms capped at 8 items.
- Data changes: NumberFlow on any number that updates (approve reduces exposure, demo date advances); row removal collapses with `layout` 240ms; toasts slide 240ms, auto-dismiss 5s with Undo.
- Status: pulsing dot (opacity 0.4-1, 1.6s) for "running" only.
- Marketing: scroll reveals 700ms ease-out-expo; hero word stagger 40ms; parallax <=24px; Lenis lerp 0.1.

**What does not animate:** table sorting/filter results (instant, or a 100ms opacity), nav route changes, hover on table rows (instant fill), chart axes and gridlines, anything >400ms in the app except number tweens, anything looping on screen, layout properties (width/height/top/left/margin) except via `layout` transform.

**Rules:** transform/opacity/clip-path only; wrap in `LazyMotion`+`domAnimation`; `useReducedMotion` plus a global `@media (prefers-reduced-motion: reduce)` that sets durations to 0.01ms and disables Lenis and NumberFlow trend animation; no `will-change` except during drawer travel; enter 240ms, exit 160ms (exits faster than entrances).

---

## 8. Suggested execution order (for the orchestrator)

1. Tokens + fonts + `Button/Panel/StatusLabel/Table/PageHeader/EmptyState/Num` + lint guard (one agent, opus-level review).
2. Shell/sidebar + Login + Dashboard (highest visibility).
3. Items table + drawer, Approvals (the demo's core path).
4. Rules, Reports, Recoveries, Runs, Eval, Settings, 404 (parallel, sonnet).
5. Landing page route group (separate agent; add `lenis`, optionally `gsap`).
6. Verification: Playwright screenshots at 320/375/768/1024/1440 for each page, axe checks, contrast spot-check against section 3.2, reduced-motion pass, grep gate for banned hues/classes.

## Sources
- https://linear.app/now/how-we-redesigned-the-linear-ui
- https://vercel.com/geist/colors
- https://gsap.com/standard-license
- https://21st.dev/blog/website-not-look-ai-generated
- https://dev.to/alanwest/how-to-fix-the-ai-generated-look-in-your-frontend-1ahh
- https://lenis.dev/ (size claim only)
- npm registry (`npm view`) for lenis, gsap, @gsap/react, motion, @number-flow/react, recharts, @tremor/react, @visx/visx, geist, @phosphor-icons/react, lucide-react
