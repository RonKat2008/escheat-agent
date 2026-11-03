# Escheat Agent: DESIGN-V3, the full UI redo

Status: spec, ready to build. Supersedes the visual sections of `docs/DESIGN-RESEARCH.md` (its audit, contrast table and information architecture still hold). Written 2026-11-03.

Scope: every route, the motion system, where 3D goes, the diagram set, ease-of-use, dependencies, and a parallel work breakdown. This document contains no app code. Implementation agents follow it literally. When something here conflicts with the installed Next.js 16 docs (`node_modules/next/dist/docs/`), the installed docs win and the agent notes the deviation in its PR.

Evidence base: `docs/DESIGN-RESEARCH.md`, `src/app/globals.css`, `src/components/shell/*`, `src/components/motion/*`, every `page.tsx` under `src/app`, the query layer (`src/lib/queries/*`, `src/db/schema.ts`), and the current screenshots in `docs/screenshots/` (`dashboard.png`, `item-drawer.png`, `marketing-home.png`, `approvals.png`, `chat.png`). The `.data/shots/ui2-*.png` and `fixC1-*.png` files named in the brief do not exist in the repo. `docs/screenshots/` and `docs/dogfood/shots/` were used in their place. Bundle sizes in section 9 were measured on 2026-11-03 by bundling the exact imports we plan to use with esbuild 0.28.2 (minify, gzip -9). Package sizes are labeled "measured" and bundlephobia figures are labeled "bundlephobia".

---

## 0. What changes and why (one paragraph)

The current UI is disciplined (strict three-hue palette, real data, tabular numbers), and that discipline stays. What it lacks is a point of view and a sense that money is moving. V3 keeps the restraint and adds three things. **Light as meaning**: glow only on what is in motion (blue) or waiting on a person (pink). **Diagrams as the primary explanation**: every page that talks about money or time shows where the money goes and when it gets there, drawn from real rows. **One spatial idea** that runs from the landing page into the app: a dark vault seen at an angle, with money traveling across it as light. 3D is used in four places only, and three of those cost zero bytes because they use CSS 3D.

---

## 1. Visual direction: "Vault Light"

**The picture:** a dark vault seen from slightly above. The floor is a faint grid. Ledger items sit on the floor as thin slabs. When the system acts on an item, a thread of electric-blue light carries it across the floor toward a state. When the flow reaches a step that needs a person, the light stops at a gate and turns pink. Nothing else glows.

### 1.1 Principles

1. **Light is state, not decoration.** Blue glow means the system is working on this right now (a run is in progress, a flow is in transit, the current loop stage). Pink glow means a person is needed now (an approval, a deadline of 7 days or less). Static, settled things never glow. At most **two glowing elements per viewport**.
2. **Every number has a path.** Any figure can be expanded into the diagram that produced it: amount → item → rule → citation. Diagrams are drawn from query rows and never from fixtures or invented values. An unknown value renders as `Unknown` with a hollow marker. It is never estimated.
3. **One hero per screen.** Each page has exactly one large element: a number, a diagram or a 3D plane. Everything else is quiet: 13px, hairlines, neutral.
4. **Depth by light and layering, not drop shadows.** Surfaces step up in lightness (ink-0 → ink-4). Overlays add one soft shadow. The 3D planes carry the sense of depth so cards don't have to.
5. **Cause before effect.** Animation always plays source first, then path, then destination: a row pulses, a line draws, a number ticks. Motion explains what happened and never just decorates.
6. **The keyboard is the fast path.** Every core action has a key. Shortcut hints (kbd chips) are visible where the action is, which also makes them a recurring visual motif.
7. **Honest by construction.** The disclaimer, UNVERIFIED badges, the REPLICA banner and "Synthetic data" labels are designed elements of the system, not afterthoughts.

### 1.2 Color tokens (strict: black + electric blue + pink; neutrals are blue-tinted black)

All tokens are in OKLCH (converted from the current hexes, so contrast data carries over; ratios were recomputed for this doc). Define them in `@theme inline` in `globals.css`, replacing the current hex block. Keep the shadcn variable mapping (`--primary`, `--ring`, ...) pointed at these.

**Surfaces**
| Token | OKLCH | Hex (ref) | Use |
|---|---|---|---|
| `--ink-0` | `oklch(0% 0 0)` | #000000 | page, landing, vault floor |
| `--ink-1` | `oklch(13.5% 0.007 269)` | #07080B | sidebar, top bar, sunken wells |
| `--ink-2` | `oklch(16.9% 0.011 268)` | #0D0F14 | panels, table body, inputs |
| `--ink-3` | `oklch(21.0% 0.018 270)` | #151821 | hover, selected row, popover, drawer |
| `--ink-4` | `oklch(25.1% 0.029 273)` | #1D2130 | pressed, active segmented control, 3D slab tops |

**Text**
| Token | OKLCH | On ink-0 / ink-3 | Use |
|---|---|---|---|
| `--fg-1` | `oklch(97.3% 0.006 265)` | 19.41 / 16.39 | primary text, values |
| `--fg-2` | `oklch(74.7% 0.024 267)` | 9.33 / 7.88 | secondary text, labels |
| `--fg-3` | `oklch(63.1% 0.036 268)` | 6.00 / 5.07 | metadata, axis labels (min allowed for text) |
| `--fg-4` | `oklch(43.6% 0.033 269)` | 2.65 / 2.24 | decoration only, never readable text |

**Lines:** `--line: oklch(100% 0 0 / 0.08)`, `--line-hover: / 0.14`, `--line-strong: / 0.22`, `--grid: oklch(70.2% 0.155 264 / 0.06)` (the vault-floor grid, blue-tinted).

**Electric blue (system / progress)**
| Token | OKLCH | Role | Contrast |
|---|---|---|---|
| `--blue-950` | `oklch(16.8% 0.049 267)` | deepest tint, 3D floor wash | n/a |
| `--blue-900` | `oklch(20.8% 0.065 266)` | info banner bg, selected-row wash | blue-300 text on it 9.38 |
| `--blue-800` | `oklch(29.6% 0.127 267)` | hover tint, Sankey link fill at 50% | n/a |
| `--blue-700` | `oklch(47.2% 0.224 264)` | pressed solid, borders on tint | white on it 7.22 |
| `--blue-600` | `oklch(54.8% 0.250 264)` | **primary solid** (fill only) | white on it 5.25; fails as text (4.00) |
| `--blue-500` | `oklch(61.6% 0.207 263)` | data series, rails, flows, icons | 5.48 on ink-0, 4.62 on ink-3 |
| `--blue-400` | `oklch(70.2% 0.155 264)` | links, small blue text, focus ring | 7.80 / 6.58 |
| `--blue-300` | `oklch(79.5% 0.103 266)` | text on tint, glow core | 10.99 |
| `--blue-200` | `oklch(88.4% 0.056 269)` | particle heads, hottest light | 14.75 |

**Pink (needs a human / urgent / error)**
| Token | OKLCH | Role | Contrast |
|---|---|---|---|
| `--pink-950` | `oklch(17.8% 0.050 3)` | gate wash in 3D | n/a |
| `--pink-900` | `oklch(24.1% 0.079 354)` | attention banner bg | pink-300 on it 10.17 |
| `--pink-700` | `oklch(43.5% 0.165 354)` | border on tint | white on it 8.72 |
| `--pink-600` | `oklch(60.1% 0.232 356)` | large non-text (bars, gates) | 4.71 on ink-0 only |
| `--pink-500` | `oklch(69.4% 0.226 354)` | **attention solid** (pill fill with black text) | black on it 6.86; 5.80 on ink-3 |
| `--pink-400` | `oklch(76.1% 0.171 350)` | pink text on dark | 9.05 / 7.64 |
| `--pink-300` | `oklch(84.8% 0.098 350)` | text on pink tint | 12.67 |

**Hard rules**
- No other hues. The existing grep/ESLint ban on `amber|green|red|emerald|sky|indigo|purple|violet|yellow|orange|teal|cyan|lime|rose|fuchsia` color utilities stays and is extended to raw `#hex`/`rgb()` outside `globals.css` and `src/components/viz/**/palette.ts`.
- Pink is never decorative. If nothing needs a human, a screen has no pink.
- Success is **blue + a check shape**, never green. Failure is **pink + an x shape**. Status is always shape + label first and color second (keep `components/primitives/status.ts` as the single map).
- Charts: series 1 `blue-500`, series 2 `blue-300`, series 3 `fg-3`, "needs you" `pink-500`, "unknown" = hollow `fg-4` outline with a dashed stroke.

### 1.3 Typography (two families, no more)

- **Geist** (variable, `next/font/google`): all UI, headings, display numbers.
- **Geist Mono** (`next/font/google`): check numbers, rule paths, hashes, kbd chips, and the **instrument labels** (see below).
- **Instrument Serif is removed** from the marketing layout to meet the two-family rule. The editorial accent it supplied is replaced by weight contrast: the emphasized word is set at weight 300 in `blue-300` against 600 `fg-1` (for example "Every uncashed check is a <span class=accent>legal clock.</span>").

Why Geist and not something new: it has verified tabular figures and stays dense and crisp at 13px, and it is already loaded (zero migration risk). The "default font" tell is offset by the signature move below and the tight display tracking.

**Signature move: instrument labels.** Eyebrows, axis labels, diagram stage names and table group labels use Geist Mono 11px / 500 / uppercase / `letter-spacing: 0.08em` / `fg-3`. They read like the labels on a measuring instrument and they sit on every diagram.

| Token | Size / line | Weight | Tracking | Family | Use |
|---|---|---|---|---|---|
| `--text-label` | 11/14 | 500 | +0.08em, uppercase | Mono | instrument labels, stage names |
| `--text-xs` | 12/16 | 400/500 | +0.01em | Sans | metadata, table headers |
| `--text-sm` | 13/20 | 400/500 | 0 | Sans | table cells, nav, dense UI |
| `--text-base` | 14/22 | 400 | 0 | Sans | body, forms |
| `--text-md` | 16/24 | 500 | -0.005em | Sans | panel titles |
| `--text-lg` | 20/28 | 600 | -0.015em | Sans | page titles |
| `--text-xl` | 28/34 | 600 | -0.02em | Sans | section heroes |
| `--text-display` | `clamp(44px, 3vw + 24px, 72px)`/1.0 | 500 | -0.045em | Sans | the one hero number per page (cents 0.5em, fg-3) |
| `--text-mkt-h1` | `clamp(2.75rem, 1.4rem + 5.2vw, 6rem)`/0.98 | 600 | -0.05em | Sans | landing h1 |
| `--text-mkt-h2` | `clamp(2rem, 1.4rem + 2.4vw, 3.5rem)`/1.05 | 600 | -0.035em | Sans | landing h2 |

Numbers: `font-variant-numeric: tabular-nums` on `.num`, table cells and every diagram label; money is right-aligned and the cents recede (existing `.money-cents` / NumberFlow parts stay).

### 1.4 Spacing, radii, elevation

- **Spacing:** 4px base. Scale `0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96, 128`. Rhythm rule: dense inside (8-12px within a group), generous between groups (32-48px), and very generous around the hero (64px above the next section). Never use the same padding at every level.
- **Layout:** app content max width 1360px (up from 1280px so diagrams have room); page gutter 16px at 375, 24px at 768, 32px at ≥1024. Sidebar 232px (collapsible to 56px, icons only, via `[`).
- **Radii:** `--r-xs 4px` (chips, kbd), `--r-sm 6px` (controls), `--r-md 10px` (panels), `--r-lg 14px` (drawers, dialogs, 3D stage frame), `--r-full` (dots, pills). Tables have 0 inner radius. Never use 16px or more inside the app.
- **Elevation (dark-mode correct: lighter surface plus a hairline, shadow only on floating layers):**
  - `e0` page: ink-0
  - `e1` panel: ink-2 + 1px `--line`
  - `e2` hover/selected: ink-3 + 1px `--line-hover`
  - `e3` floating (popover, palette, drawer, dialog, toast): ink-3 + 1px `--line-strong` + `--shadow-float: 0 24px 64px -12px oklch(0% 0 0 / 0.7), 0 2px 8px oklch(0% 0 0 / 0.5)`, plus a 1px inner top highlight `inset 0 1px 0 oklch(100% 0 0 / 0.06)`.

### 1.5 Glow (earned light)

```
--glow-blue:  0 0 0 1px oklch(61.6% 0.207 263 / 0.45), 0 0 16px -2px oklch(61.6% 0.207 263 / 0.55), 0 0 48px -8px oklch(61.6% 0.207 263 / 0.35);
--glow-pink:  0 0 0 1px oklch(69.4% 0.226 354 / 0.50), 0 0 16px -2px oklch(69.4% 0.226 354 / 0.55), 0 0 48px -8px oklch(69.4% 0.226 354 / 0.30);
--glow-text-blue: 0 0 18px oklch(70.2% 0.155 264 / 0.55);   /* only on the hero number while it is counting */
```
- Use the `.glow-live` utility (blue) for a running agent dot, the active loop stage, and in-flight flow heads.
- Use the `.glow-human` utility (pink) for the approval gate, a "due in 7 days or less" chip in a hero, and the Approvals nav count when it is greater than 0.
- Never glow a static card border, a button at rest or a logo. Hover never adds glow. Focus uses the ring and not glow.
- SVG diagrams get glow from a single shared `<filter id="es-glow">` (feGaussianBlur stdDeviation 3 + merge), defined once per diagram root and applied only to moving heads.

### 1.6 Texture: grain and grid

- **Grain:** one fixed, `pointer-events: none` overlay on `body::after`. It is an inline SVG `feTurbulence` (baseFrequency 0.9, 2 octaves) data-URI at **3.5% opacity** with `mix-blend-mode: overlay`. The overlay is static (an animated grain costs paint). It is disabled under `prefers-reduced-transparency: reduce` and in print.
- **Vault grid:** `--grid` lines at 48px, applied by the `.vault-floor` utility. It appears only under 3D planes (dashboard Money Map, landing hero, lifecycle tunnel floor) and in empty states. It fades out radially (`mask-image: radial-gradient(ellipse at 50% 40%, #000 30%, transparent 75%)`).
- **Dot desk:** the existing `.es-desk` stays for document previews (letters, NAUPA files).

### 1.7 Iconography

lucide-react only, 16px, `strokeWidth 1.5`, `fg-3` by default. There are no icon-in-colored-tile treatments. Status icons are shapes (`circle` = watching, `circle-dot` = in progress, `circle-check` = done, `circle-alert` = needs you, `circle-dashed` = unknown).

---

## 2. Motion system

Library: `motion` (already installed, 14.x) via `motion/react`, always inside `LazyMotion features={domAnimation} strict` with `m.*` components. `domMax` (which adds drag and layout projection) is loaded only on the pages that need `layoutId` for shared elements (approvals list, items drawer), through a second `LazyMotion` boundary with `features={() => import("./dom-max").then(m => m.default)}`. Simple state transitions use CSS (hover, press, rails).

### 2.1 Tokens (CSS and `src/components/motion/tokens.ts`, one source)

| Token | Value | Use |
|---|---|---|
| `--dur-instant` | 90ms | press, toggle, checkbox |
| `--dur-fast` | 150ms | hover, color, tooltip in |
| `--dur-base` | 240ms | enters, tab content, row collapse |
| `--dur-slow` | 400ms | panels, drawers (tween fallback), stepper fill |
| `--dur-draw` | 900ms | a diagram path drawing in |
| `--dur-num` | 700ms | NumberFlow / CountUp |
| `--dur-hero` | 1400ms | the hero choreography total (dashboard, landing) |
| `--ease-out` | `cubic-bezier(0.25, 1, 0.5, 1)` | default UI |
| `--ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` | entrances, bars, reveals, draws |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | layout shifts, camera moves |
| `--ease-in` | `cubic-bezier(0.5, 0, 0.75, 0)` | exits only |

**Springs (motion):**
```ts
export const SPRING = {
  snappy: { type: "spring", stiffness: 520, damping: 38, mass: 0.8 }, // nav indicator, toggles, chips
  sheet:  { type: "spring", stiffness: 420, damping: 40, mass: 1 },   // drawers, palette, dialogs (~320ms, no overshoot)
  layout: { type: "spring", stiffness: 500, damping: 42 },            // list reorder, row collapse, layoutId
  camera: { type: "spring", stiffness: 120, damping: 26, mass: 1.2 }, // 3D tilt/parallax, tunnel camera
  stamp:  { type: "spring", stiffness: 700, damping: 22 },            // "Approved" stamp (the only overshoot in the app)
} as const;
```

### 2.2 Choreography rules

1. **Cause, then path, then effect.** For any flow: the source pulses (120ms) → the path draws (`pathLength` 0→1, `--dur-draw`, ease-out-expo) → the destination value ticks (NumberFlow) as the path lands. Delays are chained explicitly and never left to guesswork.
2. **One hero sequence per page, once per session.** Reuse the existing `first-visit`/`seen` helpers. On revisit, the page renders the final state instantly.
3. **Stagger:** 30ms between list items, capped at 8 items (240ms max). Diagram nodes stagger at 60ms, capped at 10.
4. **Exits are faster than entrances:** exit duration = 0.66 × enter, with `--ease-in`.
5. **Ambient motion has one exception.** Flow particles move continuously only while their diagram is in view (IntersectionObserver) and the render tier is `full`. Everything else settles. Nothing loops in the app shell.
6. **Route changes:** the content region cross-fades 120ms. Use the React `<ViewTransition>` / Next `viewTransition` integration for item row → drawer and approval row → detail **if the installed Next 16 docs list it as supported**. Otherwise use `layoutId`. Never animate the shell.
7. **Data updates animate in place.** A number changes with NumberFlow. A removed row collapses with the `layout` spring. A new row arrives with a 1.2s `blue-900` background fade.
8. **Properties:** transform, opacity, clip-path, filter (blur ≤ 8px, only on enter), SVG `pathLength`/`strokeDashoffset`. Never animate width, height, top or left (use `layout` or scale). `will-change` is set only during the motion (drawers, the 3D camera) and removed after.
9. **Hover and press:** controls get `scale(0.98)` on press (90ms). Interactive panels lift 1px in y and switch from `line` to `line-hover` (150ms). Table rows change fill instantly, with no transition.

### 2.3 Render tiers and reduced motion

`useRenderTier()` (`src/components/viz/core/useRenderTier.ts`) returns `'full' | 'lite' | 'static'`:
- `static` if `prefers-reduced-motion: reduce`, or `navigator.connection.saveData`, or the user toggled "Reduce motion" in Settings (localStorage `es-motion=reduce`).
- `lite` if `hardwareConcurrency <= 4`, or `deviceMemory <= 4`, or WebGL2 is unavailable, or the FPS probe reports under 50fps averaged over the first 90 frames of any animated 3D/particle surface. A tier that drops never upgrades again in that session.
- `full` otherwise.

| Surface | full | lite | static (reduced motion) |
|---|---|---|---|
| Hero number | NumberFlow tween + glow-text for the 700ms | NumberFlow tween | final value, no tween |
| Path draws | pathLength draw + particles | pathLength draw, no particles | paths fully drawn, dashed flow marks to show direction |
| CSS 3D planes | tilt + pointer parallax (±4°) + camera spring | fixed tilt, no parallax | **flattened to 2D** (rotateX 0), same content |
| OGL landing scene | live, DPR ≤ 2, antialias off | live, DPR 1, half the particle count | poster image (AVIF) + SVG overlay |
| Drawers / dialogs | sheet spring | 200ms tween | opacity-only 1ms |
| Toasts | slide + fade | fade | no motion |

The global CSS block keeps `animation-duration: 0.01ms` under reduced motion, and `MotionConfig reducedMotion="user"` wraps the app. Everything under reduced motion still looks finished; nothing is left half-drawn.

---

## 3. The 3D plan (four places, and only four)

Decision summary: **no three.js, no react-three-fiber, no Spline, no cobe.** We use CSS 3D transforms for three surfaces (0 KB) and OGL for one landing-page centerpiece (14.8 KB gz measured, lazy).

Why not the alternatives:
- **three.js + r3f:** a minimal tree-shaken three bundle (`WebGLRenderer` + instanced mesh + points + tube) measured **138 KB gz**; r3f adds about 58 KB gz (bundlephobia). r3f 9.8.2 also declares peer `react >=19 <19.4` while we are on 19.3.0, which is one minor bump from breaking.
- **Spline runtime:** about 548 KB gz (depscope).
- **cobe:** 6.0 KB gz, but it renders a world globe, and our geography is three US states, so it would be the wrong shape for the story.
- **OGL:** has the same mental model as three (Renderer/Camera/Transform/Program/Mesh) and measures 14.8 KB gz for the classes we need.

### 3.1 Landing centerpiece: "The Vault" (OGL, WebGL)

- **What it shows:** a dark floor seen at about 35°, with ledger slabs laid out as an instanced grid (one slab per item in the synthetic seed shape; the count is a constant taken from the synthetic generator's documented output, and no dollar figures appear). Some slabs lift and brighten (stale). Blue light threads carry them along Bézier arcs to three labeled pylons, **CA, DE, TX**. Partway along, each thread meets a **gate ring** that holds the light and turns pink ("needs your approval"). After a beat it releases in blue and the pylon fills. A fourth, reverse thread runs from the pylons back to a "Recovered" pad, which is the recovery story. Scroll drives the camera through four keyframes that match the four "How it works" steps.
- **Library:** `ogl@1.0.11` (Renderer, Camera, Transform, Program, Mesh, Geometry, Plane, Box). Particles use a custom point shader. Arcs are line strips sampled from cubic Béziers on the CPU at init, and the draw range grows per frame (the Stripe globe technique).
- **Bundle:** 14.8 KB gz (measured) plus about 6 KB of our own scene code and shaders. Loaded with `next/dynamic(() => import(...), { ssr: false })` **after LCP**: triggered by `requestIdleCallback` (timeout 2s) and only if the hero is in view and the tier is not `static`.
- **Static fallback:** `public/marketing/vault-poster.avif` (1600×1000, under 60 KB) + `.webp` fallback, rendered by a Playwright script from the live scene at its rest frame (slice 9 owns `scripts/render-vault-poster.ts`). The poster is the LCP element and has `fetchpriority="high"`. HTML labels (CA/DE/TX, gate and step captions) are DOM elements laid over both poster and canvas, so they are accessible and identical in both. The canvas is `aria-hidden`, and a visually hidden `<figure>`/`<figcaption>` describes the flow.
- **Perf budget:** 60fps at 1440×900 on an M1 Air; at most 2,500 instances, 600 particles and 4 arcs; `antialias: false` (per Stripe's write-up); DPR clamped to `min(devicePixelRatio, 2)` in `full` and 1 in `lite`; render loop paused when off-screen (IntersectionObserver) or when the tab is hidden (`visibilitychange`); a frame-time probe drops to `lite` under 50fps and to the poster under 30fps. GPU memory stays under 40 MB, and there are no textures except one 64×64 sprite generated in code.

### 3.2 Dashboard hero: "Money Map" (CSS 3D + SVG, 0 KB)

- **What it shows:** a US outline with CA, DE and TX filled as the floor of a tilted plane (`perspective: 1400px; transform: rotateX(54deg) rotateZ(-8deg)` on the plane). On each of the three states stands an **exposure column**: a CSS 3D box (four faces plus a top, built from divs with `translateZ`) whose height is proportional to that state's `exposure.byState[].cents`, with a minimum visible height of 6px and a hollow dashed outline if the count is 0. From the company HQ (the company's state of incorporation, from `getCompany`) blue arcs rise out of the plane to each column. Particles move along the arcs, with a count per arc that scales with that state's item count (capped at 12). Column tops carry DOM labels (state, amount, count, UNVERIFIED badge if `anyUnverified`). If an item in that state has a deadline within 7 days, that state's column top gets a pink gate ring.
- **Why CSS 3D:** three boxes and three arcs do not need WebGL. CSS 3D with SVG is crisp at any DPR, the DOM labels are accessible, it SSRs as a 2D map, and it costs 0 bytes beyond our components.
- **Geography data:** the state paths are precomputed at dev time by `scripts/gen-us-paths.ts` (d3-geo `geoAlbersUsa` + topojson-client + us-atlas `states-10m`, all devDependencies) into `src/components/viz/money-map/us-paths.ts`. That file holds the national outline plus all 50 state paths simplified to 0.5px tolerance (about 18 KB gz committed, server component only, never shipped as JS because the SVG is rendered on the server).
- **Interaction:** pointer parallax ±4° on the plane (`camera` spring, tier `full` only). Hovering or focusing a column highlights its arc and opens a tooltip with the top 3 items. Clicking navigates to `/items?state=CA`. Arrow keys move between columns, which are `role="link"` with a full accessible name, for example "California: $28,410.00 across 21 items, 2 due within 7 days".
- **Fallback:** under `static` the plane renders at `rotateX(0)` as a flat 2D map with bars drawn as SVG rects. The content is identical.
- **Perf budget:** 60fps on parallax. Animate only `transform` on the plane wrapper; particles are SVG `<circle>`s moved with `offset-path`/`offset-distance` CSS animations (compositor-friendly in Chromium) and capped at 36 in total. Particles pause when the map is off-screen.

### 3.3 Item lifecycle "tunnel" (CSS 3D, 0 KB)

- **What it shows:** in the item drawer (and full-page at `/items/[id]` if slice 3 adds it), the item's legal lifecycle is laid out as **rings receding in depth**: Issued → Stale → Presumed abandoned (dormancy) → DD window opens → DD window closes → Report due → Remit due. Each ring is a DOM element at `translateZ(-i * 220px)` inside a `perspective: 900px` container, with the date, a label and a rule chip. The "today" marker is a blue plane that sits between the rings at the correct proportional depth. Past rings are solid blue-500; the next one has a pink ring if it is within 7 days and a blue ring otherwise; future ones are outlined. Unknown dates render as dashed `fg-4` rings labeled `Unknown`.
- **Interaction:** `j`/`k` or the scroll wheel moves the camera (container `translateZ`) ring to ring with the `camera` spring. Clicking a ring opens its derivation (`TimelineEvent.derivation[]`, `sources[]`) in a side card.
- **2D twin:** `LifecycleRail` (slice 1, a horizontal SVG rail) shows the same data and is used everywhere else (approvals detail, owner page, chat views). The tunnel is an enhancement: it is toggled with the `3D` segmented control in the drawer header, defaults to the rail on mobile (<768px) and under `static`, and remembers the choice in localStorage.
- **Data:** `explainItem(db, id).timeline` (TimelineEventSchema: key, label, date, status, verified, ruleVersion, rulePaths, sources, derivation, roll) plus `item.issueDate` and `item.staleSince`.
- **Perf:** at most 8 rings; only transform and opacity animate; no particles in the tunnel.

### 3.4 Approval "gate" stamp (CSS 3D, 0 KB, tiny)

When a draft is approved, the detail card performs a 3D card flip (`rotateY` 0→180°, 520ms, `sheet` spring). The back face shows the approved payload hash and approver, and the "Approved" stamp lands with the `stamp` spring. Under `static` it cross-fades instead. This gives the core loop a tactile, memorable moment for the demo.

### 3.5 Where 3D is explicitly not used

There is no 3D in tables, forms, settings, rules lists, eval, runs or the replica portals. There are no 3D tilt cards on hover, and none of the Aceternity-style "3D card" or "spotlight" effects.

---

## 4. Diagram plan (real data only)

Shared rules: SVG rendered by React, with layout computed in pure functions that have unit tests (`*-model.ts` next to each diagram, following the existing `chart-model.ts` pattern). Every diagram has: an instrument-label title, a visually hidden `<table>` alternative with the same numbers (`sr-only`), keyboard focus on nodes, tooltips on hover and focus, and an empty state that explains what will appear. Zero-value links are omitted and never drawn as hairlines. Unknown values are drawn hollow and dashed. Every diagram is labeled "Synthetic demo data" when the company is the synthetic demo company (reuse the existing "Demo data" chip logic).

### 4.1 Lifecycle diagram (per item)

- **Components:** `LifecycleRail` (2D, slice 1, `src/components/viz/core/LifecycleRail.tsx`) and `LifecycleTunnel` (3D, slice 3).
- **Library:** none. The rail is hand-placed SVG on a time scale (a 20-line linear scale in `viz/core/scales.ts`; we don't add d3-scale), with motion `pathLength` drawing the progress segment.
- **Data:** `explainItem().timeline` + issueDate/staleSince + `asOf` (sim clock). Stage nodes keyed by `TimelineEvent.key`. Badges: `UNVERIFIED` where `verified === false`, `Unknown` where `status === "unknown"`. The rule chip shows `ruleVersion` and the first `rulePaths[0]` in mono and opens the source list.
- **Animation:** the rail draws from Issued to today (900ms), then the "today" marker drops in, then the next-deadline node pulses once (pink if 7 days or less).

### 4.2 Money-flow Sankey (dashboard; a compact version on recoveries)

- **Columns (left to right):** `Ledger outstanding` → {`Cleared or voided`, `Stale`} → from Stale: {`Resolved with owner`, `In due diligence`, `Watching`, `Needs rule`, `Reportable: CA`, `Reportable: DE`, `Reportable: TX`} → from Reportable: {`Reported`, `Remitted`}. A separate reverse band from the right edge: `State portals` → `Recovered to you` (`recoveries` status `paid`) and `Claims in progress` (statuses `found`…`claim_submitted`).
- **Library:** `d3-sankey@0.12.3` for layout and `d3-shape` for link paths. The pair measured **6.96 KB gz** for `sankey`, `sankeyLinkHorizontal`, `linkHorizontal`, `line` and `curveBasis`. Rendering is React SVG, and animation uses motion `pathLength` with a particle layer (tier `full`).
- **Data source:** a new server query `getMoneyFlow(db, companyId)` in `src/lib/queries/flow.ts` (slice 2), computed from `ledger_items` (amount and count grouped by `ledger_status`), `stale_items` (grouped by `stale_status` and owner state) and `recoveries` (grouped by `recovery_status`). It returns `{ nodes: {id,label,cents,count}[], links: {source,target,cents,count}[], asOf }`. Link widths are proportional to cents. Rules: if a ledger total is unavailable (for example an ingest without cleared rows), the diagram starts at `Stale` and says so. Values are never back-filled. Unit tests assert that the sum of incoming cents equals the sum of outgoing cents per node, and that zero links are dropped.
- **Color:** links are blue-800 at 50% with a blue-500 edge. Links into a node that needs a human (in DD with an approval pending, reportable with a deadline of 7 days or less) are pink-600 at 40%. Recovered links are blue-300.
- **Interaction:** hovering a link dims everything else to 25% opacity and shows a tooltip with amount and count. Clicking a node navigates to the filtered items list (`/items?status=to_report&state=TX`).

### 4.3 Approvals pipeline (approvals page header; mini version in the Loop Bar)

- **Shape:** three horizontal swimlanes, **Outreach**, **Reports** and **Recoveries**, each a row of stage nodes connected by rails:
  - Outreach: `draft → awaiting_approval → approved → sent → delivered → responded` (with `failed`/`cancelled` as an off-ramp below)
  - Reports: `draft → validated → awaiting_approval → approved → submitted → confirmed` (`failed` off-ramp)
  - Recoveries: `found → claim_drafted → awaiting_approval → claim_submitted → paid` (`rejected` off-ramp)
  - All three `awaiting_approval` nodes align vertically into one **pink gate column** labeled "YOU". This column is the visual thesis of the product: the agent does everything up to the gate.
- **Library:** none (fixed layout, hand-placed SVG, motion). Rails animate with flowing dashes (`strokeDashoffset`) only on lanes that have items in motion.
- **Data source:** a new `getPipeline(db, companyId)` in `src/lib/queries/pipeline.ts` (slice 4), with counts and cents grouped by status from the `outreach`, `reports` and `recoveries` tables. Nodes with count 0 are drawn outlined and labeled `0`.
- **Interaction:** clicking a node filters the approvals list (or links to reports/recoveries). The gate column count matches the nav badge exactly (the same query that powers `queue-count.ts`).

### 4.4 Rule provenance graph (rules field drawer; "Why this date?" in the item drawer)

- **Shape:** a left-to-right layered graph: **Value** (for example `3 years`) → **Rule path** (`rules/TX.json › propertyTypes.vendor_check.dormancyYears`, mono) → **Sources** (1-n nodes: title and domain, with the quoted excerpt on expand) → **Verification** (`UNVERIFIED` badge, or "Verified by {approver} on {date}" from `rule_changes`). For item dates a further column on the left shows the **derivation steps** (`TimelineEvent.derivation[]`, one node per sentence) feeding the date.
- **Library:** `d3-shape` `linkHorizontal` (already counted in 4.2's 7 KB) plus a hand layered layout (column x fixed, y by index). `@xyflow/react` (60 KB gz, bundlephobia) is rejected because the graph is small, static and not editable.
- **Data source:** rules from `src/lib/rules/load.ts` and `state_rules`/`rule_changes` rows (rules page data.ts already loads these); item dates from `explainItem().timeline[].{rulePaths, sources, derivation, verified, roll}`.
- **Interaction:** source nodes are real links (open in a new tab, with an external icon). Hovering highlights the path, and the draw animation runs once on open.

### 4.5 Smaller diagrams (reuse the core kit)

- **Deadline river (forecast and dashboard):** a 90-day horizontal time axis with deadline events as stacked marks, where the 7-day window is shaded pink-900. The data is `upcomingDeadlines()` / `getForecast()`. Recharts is kept for the forecast's monthly bars (already installed and restyled), and the river is custom SVG.
- **Activity density strip:** the existing `DayStrip`, restyled as a 30-cell "seismograph" (bar heights, blue, pink for days with human actions).
- **Recovery flow:** a compact Sankey (same component, `variant="recovery"`) from State portals to Found to Claimed to Paid, from `recoveries`.
- **Eval bars:** existing; restyled per 6.15.

---

## 5. Ease-of-use plan

### 5.1 The Loop Bar (new, shell-level, always visible)

A slim strip under the top bar on every app page shows the core loop as four connected stages with live counts:

`TRIAGE 4 → DRAFT 2 → APPROVE 2 → FILE 1`

- **Triage** = stale items in `dd_pending` or `needs_rule`, or with `needsReview`.
- **Draft** = items in a DD window without an outreach draft.
- **Approve** = all `awaiting_approval` (outreach + reports + recoveries).
- **File** = reports `approved` but not `submitted`.
- Stage styling: count greater than 0 and human-blocked gives a pink count; system-in-progress (a running agent run) gives a blue glow-live dot; 0 gives `fg-3`. The current page's stage gets an underline that moves with the `snappy` spring.
- Clicking a stage goes to the preset view: `/items?view=needs-action`, `/items?view=draft-ready`, `/approvals`, `/reports?filter=approved`.
- Data: `src/components/shell/loop-data.ts` (server), which composes the existing queries (`getStatusCounts`, queue-count) plus one count over reports. It is cached per request.
- Keyboard: `g t` / `g d` / `g a` / `g f` jump to each stage.

### 5.2 Next best action

- `src/lib/next-action.ts`: a pure, unit-tested, deterministic priority function over the loop counts and the deadlines. The order is: (1) approvals with a deadline within 7 days, (2) any approvals, (3) items due for DD without a draft, (4) approved reports to file, (5) unverified rules that block dates, (6) "All clear. Next deadline {date}".
- Surfaces: the right end of the Loop Bar shows one pill, for example `Approve 2 letters · due tomorrow  ⏎`. Pressing `⏎` while the shell (not an input) has focus, or `.` anywhere, runs it. The same action is the first item in the command palette and the primary button on the dashboard hero.

### 5.3 Command palette v2 (cmdk, existing dependency)

- Sections: **Do** (verbs: Approve next, Draft letters for selected/due items, Generate report for {state}, Run recovery search, Advance demo date, Toggle reduce motion), **Go** (pages, with `g` chords shown), **Find** (items by check # or payee via the existing `searchItemsAction`, payees, rules by path), **Ask** (sends the query to `/chat?q=`).
- Each result row shows its shortcut as a kbd chip. Fuzzy match is the cmdk default. Recent commands are pinned to the top (localStorage, at most 5).
- Motion: the palette scales from 0.98 and fades in (`sheet` spring), results do not stagger, and the selection indicator moves with `layoutId`.
- `?` opens the **Shortcuts sheet**: a full keyboard map grouped by page, generated from the same registry (`src/components/shell/shortcuts.ts`), so hints and handlers never drift.

### 5.4 Keyboard flows (registry-driven)

| Key | Where | Action |
|---|---|---|
| `⌘K` / `Ctrl K` | anywhere | palette |
| `?` | anywhere | shortcuts sheet |
| `.` | anywhere | run next best action |
| `g` then `d i p a f c r e s` | anywhere | go to dashboard, items, payees, approvals, forecast, chat, rules, reports, settings |
| `[` | app | collapse/expand sidebar |
| `/` | lists | focus filter/search |
| `j` / `k` | lists, drawer tunnel | move selection / camera |
| `↵` | lists | open |
| `x` | lists | toggle select |
| `⇧↓` / `⇧↑` | lists | extend selection |
| `d` | items | draft outreach for selection |
| `a` | approvals | approve (opens confirm on irreversible actions) |
| `⌘↵` | approvals | approve and advance to next |
| `r` | approvals | reject (focuses the reason field) |
| `e` | approvals | edit draft |
| `Esc` | overlays | close / clear selection |

Shortcuts are disabled while focus is in an input, textarea or contenteditable. All of them are announced via `aria-keyshortcuts`.

### 5.5 Fewer clicks for the core loop

Target: **one item from triage to filed in 6 interactions or fewer**, and **a batch of N in 6 + 0 per item** using bulk.
1. Dashboard hero CTA (or `.`) → Items in the "Needs action" view, with the first row selected.
2. `⇧↓` to select the due items, then `d` to draft outreach for all of them (existing `bulk-draft` route). A toast confirms with "Review drafts →".
3. `⏎` on the toast (or `g a`) → Approvals, first draft open, letter preview visible.
4. `⌘↵` approves and advances. The flip-stamp plays and the next draft is shown. Bulk approve (existing `BulkApprove`) is available for identical templates.
5. When reports are approvable, the Loop Bar's `FILE` stage lights up. Clicking it (or `g f`) opens Reports with the state preselected.
6. "File to portal" starts the agent run, and the shell shows the run inline (glow-live dot) with a link to watch it in the replica.

### 5.6 Onboarding and empty states

- **First run** (no ledger rows): the dashboard replaces the hero with a three-step **Setup rail** (Connect ledger: QBO or CSV · Connect bank clears: Plaid or CSV · Review rules) over a ghosted Money Map (outline only, no numbers, `fg-4`). Each step deep-links to Settings › Integrations. The Loop Bar shows `—` counts and the hint "Connect a ledger to start".
- **EmptyState primitive** (slice 1): an instrument-label eyebrow, a heading that states the fact, one sentence on what will appear, one primary action, and the future layout ghosted at 30% opacity with the vault grid behind it. There are no illustrations.
- **Inline teaching:** the first time each diagram is shown, a single dismissible coach mark (`ⓘ How to read this`) appears. Dismissal is remembered in localStorage, with no modal tours.

---

## 6. Page-by-page redesign

Global for every page: shell (sidebar + top bar + Loop Bar), the disclaimer line in the footer (`DISCLAIMER` from `src/lib/disclaimer.ts`), a page header (instrument-label eyebrow, 20px title, one-line description, actions on the right), and exactly one hero.

### 6.0 Shell (slice 1)
- **Layout:** sidebar 232px (collapsible to 56px) · top bar 48px (breadcrumb, palette trigger `Search or run a command ⌘K`, demo-date control, "Synthetic data" chip, user menu) · Loop Bar 40px · content · footer with the disclaimer.
- **Brand:** a wordmark in Geist 600 and a new flat mark: a 16px square with one blue-500 diagonal "thread" line (no gradient tile, no bolt).
- **Nav:** groups Work / Setup / Agents (keep `nav-items.ts`). The active indicator is a `layoutId` pill on ink-3 with the icon in blue-400. The Approvals count is pink with `.glow-human` when greater than 0.
- **Mobile (<1024):** the sidebar becomes a bottom sheet (existing MobileNav, restyled); the Loop Bar becomes a horizontally scrollable chip row with `overflow-x: auto` and `scroll-snap` inside its own container, so the page itself never overflows.
- **Components:** `AppShell`, `SideNav`, `TopBar`, `LoopBar`, `NextActionPill`, `CommandPalette`, `ShortcutsSheet`, `DemoClock`, `Brand`, `MobileNav`, `Footer`.

### 6.1 Landing `/` (slice 9)
- **Layout:** sticky nav (wordmark, How it works, Security, `Open the demo` solid blue) → hero → proof line → "How it works" scrollytelling (4 steps, sticky visual = The Vault camera keyframes) → lifecycle explainer (an animated `LifecycleRail` with labels only; the dates are the ones quoted from rule files that the current page already uses, each marked UNVERIFIED) → "Nothing leaves without you" (an approvals gate diagram, structure only) → honest limits (synthetic data, three states, replica portals) → CTA → footer with the disclaimer.
- **Hero element:** left column h1 "Every uncashed check is a *legal clock.*" (accent via weight and blue-300), a two-line lead and two CTAs. The right column bleeds off the viewport with **The Vault** (poster first, then OGL). Vault grid and grain sit behind it.
- **Key animations:** the h1 reveals line by line (clip-path inset, 700ms, 60ms stagger); the poster crossfades to the live canvas over 400ms when ready; scroll moves the camera between the four keyframes (motion `useScroll` → camera uniforms; Lenis stays and is disabled under reduced motion); section reveals use opacity + 16px y at 700ms ease-out-expo, once.
- **Components:** `SiteNav`, `HeroVault` (poster, lazy canvas, DOM labels), `VaultScene` (OGL), `ScrollSteps` (existing, rebuilt), `LifecycleExplainer`, `GateExplainer`, `HonestLimits`, `Cta`, `SiteFooter`.
- `/how-it-works` and `/security`: the same system, with sections reusing `LifecycleRail`, `GateExplainer` and the provenance graph in illustrative mode (rule-file content only, no company data).
- **Budget:** initial JS under 250 KB gz (section 9). The OGL chunk loads after idle.

### 6.2 Login `/login` (slice 8)
- **Layout:** a split at ≥1024px. Left is the vault floor with a slow, static Money Map silhouette (outline only, no numbers) and the wordmark. Right is a 360px form (passcode field and a solid blue `Enter` button) with the disclaimer under it.
- **Animation:** the form rises 8px/240ms; an error does a 3-cycle 2px x-shake and turns the border pink-500.
- **Components:** `LoginSplit`, `LoginForm` (existing logic), `VaultSilhouette`.

### 6.3 Dashboard `/dashboard` (slice 2)
- **Layout (1440):** row 1, the hero: on the left (5 cols) the display number `At risk today` with NumberFlow plus the sentence "47 stale items across 3 states, as of Nov 1, 2026" and the NextAction primary button; on the right (7 cols) the **Money Map**. Row 2 is a full-width **Money-flow Sankey** (height 320). Row 3 has two columns: **Next deadlines** (a deadline river plus the top 5 rows) and **Needs you** (gate count, a mini pipeline from `getPipeline`, and the by-status rows). Row 4 holds audit-interest exposure (keeps `Unknown`, which stays honest) and a featured item with its `LifecycleRail`.
- **375:** the hero number goes first, then the Money Map in a flattened 2D variant (tier forced to `lite` and `rotateX(30deg)` to fit, height 260), then a Sankey rotated to a vertical layout (`orientation="vertical"` prop) and the lists.
- **Choreography (first visit, about 1.4s):** the number ticks while its glow-text blooms (0-700ms); at 300ms the map plane settles from `rotateX(64deg)` to 54° (`camera` spring); at 500ms the arcs draw from HQ to each state, staggered 120ms; as each arc lands, its column grows (scaleZ via the face heights, using transform) and its label fades in; at 1000ms the Sankey links draw left to right; particles start at the end. Revisits render the final state instantly.
- **Components:** `ExposureHero`, `MoneyMap` (`MapPlane`, `StateColumn`, `FlowArc`, `ColumnLabel`), `MoneyFlowSankey`, `DeadlineRiver`, `NeedsYouPanel` (+ `PipelineMini`), `AuditInterest`, `FeaturedItem`, `SetupRail` (first run).

### 6.4 Items `/items` (slice 3)
- **Layout:** a page header with saved-view tabs (`All · Needs action · Draft-ready · Due ≤ 90d`, with counts), a filter bar (`/` search, `+ Filter` chip popover, removable chips; nuqs URL state), and a full-page table with a sticky header. A sticky **footer sum** shows the count and total of the filtered rows. Selecting rows reveals the bulk bar (existing `bulk-bar.tsx`), docked bottom-center with kbd hints.
- **Hero:** the table is the hero. Above it, a thin **state ribbon** (a stacked bar CA/TX/DE with amounts) doubles as a filter.
- **Drawer (560px):** header (check #, payee, amount, status, primary action), then an **Owner and state** block, the **Lifecycle** (tunnel or rail toggle), "**Why this date?**" (opens the provenance graph for the next deadline in a nested panel), outreach and activity. The drawer opens with the `sheet` spring and, when supported, the row → drawer title is a shared element.
- **Key animations:** the selection rail moves with scaleY; filter results swap with a 100ms opacity change and no stagger; a newly drafted row gets the blue-900 fade.
- **Components:** `ItemsTable`, `SavedViews`, `FilterBar`, `StateRibbon`, `FooterSum`, `BulkBar`, `ItemDrawer`, `LifecycleTunnel`, `WhyThisDate`.

### 6.5 Payees `/payees` (slice 3)
- **Layout:** a table of payees (name, merged aliases count, items, total, owner state, basis), and a drawer with merge provenance (the existing `name-diff` highlights) and a change dialog.
- **Hero:** a compact **alias cluster**: for the selected payee, a radial of raw name variants connected to the canonical name, with the edge label showing the merge basis (`exact/rule/model/human`) and model merges in pink until confirmed by a human. The data is `payees` and `ledger_items.payeeNameRaw`.
- **Components:** `PayeesTable`, `PayeeDrawer`, `AliasCluster`, `ChangeDialog` (existing logic).

### 6.6 Approvals `/approvals` (slice 4)
- **Layout:** the **Approvals pipeline** diagram on top (collapsible to a one-line summary after first view), then master-detail: on the left a list (tabs All / Letters / Emails / Reports / Claims, with j/k), on the right the detail. The detail contains "What will happen" (a single sentence), the letter/email **preview on the desk** (`.es-desk` with a paper sheet), the safety checklist (blue checks / pink x's), the item `LifecycleRail`, and a sticky action bar (`Approve and send ⌘↵`, `Reject r`, `Edit e`).
- **Hero:** the pipeline gate column ("YOU").
- **Key animations:** on approval the card flips (3D, section 3.4), the gate count ticks down, the list row collapses (`layout` spring) and the next item slides in. A sonner toast offers Undo (5s) where the API allows it. Otherwise the toast is informational and the confirm dialog has already appeared for irreversible actions.
- **Components:** `ApprovalsPipeline`, `ApprovalList`, `ApprovalDetail`, `DeskPreview`, `SafetyChecklist`, `ApproveBar`, `FlipStamp`, `BulkApprove` (existing).

### 6.7 Forecast `/forecast` (slice 6)
- **Layout:** filters (state, horizon) → hero **deadline river** (12 months, with the today line, a pink 7-day window, and events stacked by kind) → monthly cash-out bars (recharts, restyled) → a calendar table with an "Add to calendar" ICS button (existing).
- **Key animations:** the river scrolls horizontally on drag (inside its own container) and the today line pulses once.
- **Components:** `ForecastFilters`, `DeadlineRiver` (full), `MonthlyBars`, `CalendarList`, `AddToCalendar`.

### 6.8 Activity `/activity` (slice 6)
- **Layout:** the density "seismograph" strip (30 days) as the hero, then filters (kind chips from `ACTIVITY_KINDS`), then a vertical **timeline feed** with day headers. Each entry carries a kind glyph, the actor (agent or person: agents get a blue thread glyph, people a pink dot when they took an approval action), a summary and links. The CSV export stays.
- **Key animations:** clicking a strip day scrolls the feed to it (smooth scroll in the container, instant under reduced motion); new entries arrive with the blue-900 fade.
- **Components:** `DensityStrip`, `ActivityFilters`, `ActivityFeed`, `ActivityEntry`.

### 6.9 Rules `/rules` (slice 5)
- **Layout:** state tabs CA / DE / TX, each showing `n / m verified` as a ring meter. Fields are grouped by type in collapsible sections. Each row has the field, the value (with an `UNVERIFIED` badge when unverified), the source count and a hover action. Clicking a row opens the **field drawer**, whose hero is the **provenance graph**, along with the approve-rule-change action (existing `approve-button.tsx`) and the version diff (existing).
- **Hero:** the verification ring meters (blue arc = verified, `fg-4` track). An unverified field that blocks a live date shows the count of affected items in pink ("blocks 12 dates").
- **Components:** `StateTabs`, `VerifyMeter`, `RuleGroup`, `RuleRow`, `FieldDrawer`, `ProvenanceGraph`, `VersionDiff`, `ApproveRuleChange`.

### 6.10 Reports `/reports` (slice 5)
- **Layout:** state segmented control → a **filing stepper** hero (Generate → Validate → Approve → File → Confirmed) drawn as a horizontal rail whose fill animates (scaleX) as each step completes. Next to it sits the report summary (items, amount, holder, period). Below are the validation lists (existing), the NAUPA file preview on the desk, and portal evidence (screenshots from agent runs, opened in the lightbox).
- **Key animations:** steps fill in sequence. While an agent files, the "File" step shows the glow-live dot and a live step log (it subscribes to the existing run polling via `useRun`).
- **Components:** `StateSwitch`, `FilingStepper` (rebuilt), `ReportSummary`, `ValidationLists`, `NaupaPreview`, `PortalEvidence`, `ReportActions`.

### 6.11 Recoveries `/recoveries` (slice 6)
- **Layout:** the hero shows "Found for {company}" as a display number (blue-400 when greater than 0, `fg-3` at 0), with "Run recovery search" next to it. Below are a **recovery flow** mini Sankey (portals → found → claimed → paid), the portal strip (CA/DE/TX with last searched and matches), and claim cards (existing `ClaimCard`, restyled) showing a name-match diff and a confidence bar.
- **Key animations:** during a search each portal tile runs a determinate progress thread (blue) with step text, and results arrive with the blue-900 fade.
- **Components:** `RecoveryHero`, `RecoveryFlow`, `PortalStrip`, `ClaimCard`, `RunRecoveryButton`.

### 6.12 Chat `/chat` (slice 7)
- **Layout:** a centered conversation column (max 760px) with the composer docked at the bottom. Generative views (the existing `components/chat/views/*`) render as inline panels using the same primitives: `ExposureView` uses a mini Money Map in flattened 2D, `ItemTimelineView` uses `LifecycleRail`, `ApprovalCardView` uses the approve bar, and `RulesView` uses a provenance link. Suggested follow-ups show as chips.
- **Hero:** an empty state with four starter prompts as large chips over the vault grid.
- **Key animations:** streaming text with no per-token animation (a caret blink only), view panels enter with 240ms rise, and tool calls show as a collapsible "agent thread" with a glow-live dot while running.
- **Components:** `ChatApp` (existing logic), `Messages`, `Composer`, `ToolTrace`, view restyles.

### 6.13 Agent runs `/runs` and `/runs/[id]` (slice 7)
- **List:** a table (time, agent, task, steps, duration, cost, status shape). Running rows show the glow-live dot and a live elapsed timer.
- **Detail:** the hero is a **run thread**: a vertical rail of steps (Vercel build-log style) with per-step duration bars on a shared time axis (a mini Gantt) and screenshot thumbnails (existing `ShotLightbox`). Tool input and output appear in mono code wells (`JsonView`). Approval pauses render as a pink gate node with the approver.
- **Key animations:** live steps append with a 160ms fade, the rail extends, and the current step pulses.
- **Components:** `RunsList`, `RunStatus`, `RunThread`, `StepViewer`, `StepGantt`, `ShotLightbox`, `LiveRefresh`.

### 6.14 Eval `/eval` (slice 7)
- **Layout:** a neutral blue-900 info banner explaining the baseline, then a hero stat strip (overall %, generated %, adversarial %, run date) with NumberFlow, then horizontal bars per category (blue fill for generated, hatched blue for adversarial), then a misses table (expected in `fg-1`, got in pink-400).
- **Components:** `EvalBanner`, `EvalStats`, `EvalBars`, `MissesTable`, `RunMeta`.

### 6.15 Settings `/settings/integrations` (slice 8)
- **Layout:** integration rows (QuickBooks Online, Plaid, CSV ledger, CSV bank clears, AgentMail, Lob), each with a status shape and label, a one-line description and a `Configure` action that opens a drawer with environment instructions. The CSV drop zone is the only dashed border in the app. Add a **Preferences** section: Reduce motion (system / on / off), Default lifecycle view (rail / 3D), and Density (comfortable / compact).
- **Hero:** a **connection diagram**: sources (QBO, Plaid, CSV) → Escheat Agent → outputs (Lob, AgentMail, Replica portals), with live connections drawn as solid blue threads and unconfigured ones dashed `fg-4`. The data is `/api/integrations/status`.
- **Components:** `ConnectionDiagram`, `IntegrationRow`, `IntegrationDrawer`, `CsvDropZone` (existing csv-card logic), `Preferences`.

### 6.16 Replica portals `/replica/**` (slice 5)
- **Keep the deliberately dated government look** (`replica.css`) and **keep both REPLICA banners** (top and bottom, `data-testid` unchanged), the `[REPLICA]` title prefix, and the disclaimer. Do not apply Vault Light here. The contrast is the point: the agent drives a clunky portal.
- Changes are limited to: a fix for any WCAG AA failures, no horizontal overflow at 375, visible focus styles, and a small fixed "Driven by Escheat Agent · run #id" chip (ink-1 with a blue thread glyph) bottom-right **only** when the query string has `?run=` (set by the agent). The chip links back to `/runs/[id]`.

### 6.17 Owner pages `/owner/[token]`, `/owner/link-error` (slice 4)
- **Audience:** the payee (owner), not the finance user. It must look trustworthy and plain, with no internal jargon, no Loop Bar and no sidebar.
- **Layout:** a centered 560px card on ink-0 with the company name, "We are holding $X for you", a `LifecycleRail` in a simplified owner variant (Issued → "We tried to reach you" → "Deadline to respond before it goes to the state of {ST}"), and three large response buttons (Confirm my address / I already cashed it / Send me the money; existing actions). After a response, a confirmation with the stamp animation. The disclaimer goes in the footer.
- **Link error:** a plain explanation and contact line, with no 3D.
- **Components:** `OwnerShell` (existing, restyled), `OwnerRail`, `ResponseChoices`, `OwnerConfirmed`.

### 6.18 404 / error / global-error (slice 1)
- **404:** a large `404` in `fg-4` display with a dashed lifecycle ring labeled `Unknown route`, plus "Back to dashboard". It is left-aligned.
- **Error:** a plain message, a `Retry` button, and the error digest in mono. There is no stack trace (keep `safe-error.ts`).

---

## 7. Component inventory (slice 1 delivers; everyone consumes)

**`src/components/ui/*` (restyled shadcn/Base UI):** button (primary/secondary/ghost/danger-outline; sizes 28/32/40), input, select, tabs (underline + segmented), dialog, sheet (drawer), popover, dropdown-menu, tooltip, table, scroll-area, separator, skeleton, sonner, badge (kept for compatibility; prefer `StatusLabel`), and new: `kbd`, `segmented`, `checkbox`, `switch`.

**`src/components/primitives/*`:** `PageHeader`, `Section`, `Panel`, `StatusLabel` (shape + label; `status.ts` stays the map), `UnverifiedBadge` (mono 10px uppercase `UNVERIFIED`, 1px `line-strong` border, `fg-2`, tooltip "This rule value has not been verified by a person. Dates that depend on it are provisional."; it must render on **every** unverified value), `UnknownValue`, `Money` / `NumFlow` (NumberFlow, cents receding), `DateCell`, `SourceLink`, `KpiStat`, `EmptyState`, `InstrumentLabel`, `Disclaimer`, `SyntheticChip`, `CopyValue`.

**`src/components/motion/*`:** `tokens.ts` (durations, easings, SPRING), `MotionRoot` (LazyMotion + MotionConfig reducedMotion="user"), `Reveal` (in-view once), `Stagger`, `DrawPath`, `CountUp` (kept), `first-visit`/`seen` (kept), `dom-max.ts` (lazy features), `useHeroOnce`.

**`src/components/viz/core/*`:** `scales.ts` (linear/time/band, pure), `palette.ts` (the only place viz colors live, mapped to CSS vars), `useRenderTier.ts`, `useInViewport.ts`, `FlowParticles.tsx` (SVG offset-path particles, tier-aware), `GlowFilter.tsx`, `VizTooltip.tsx`, `SrTable.tsx`, `Stage3D.tsx` (perspective container: tilt, parallax, flatten under static), `LazyCanvas.tsx` (poster → dynamic import → crossfade; owns visibility/idle/tier logic), `LifecycleRail.tsx` (+ `lifecycle-model.ts` + test), `StageTrack.tsx` (generic stage nodes + rails, used by pipeline, stepper and owner rail), `SourceChain.tsx` (value → path → source mini inline chain).

**`src/components/shell/*`:** as in 6.0, plus `shortcuts.ts` (registry), `useShortcuts.ts`, `loop-data.ts`, `LoopBar.tsx`, `NextActionPill.tsx`, `ShortcutsSheet.tsx`.

**`src/components/b/*`:** behavior helpers (ActionButton, ApiProblem, ApproverField, CopyButton, JsonView, RowCheckbox, Skel, trace, useRun) stay in slice 1's ownership and are restyled only. Their APIs stay stable.

---

## 8. Non-negotiables (every slice, every screen)

1. **Disclaimer** "Prototype. Not legal advice. Confirm filings with a qualified professional." is visible on every screen: the app footer, marketing footer, login, owner pages and replica footer. It is imported from `src/lib/disclaimer.ts`, never retyped.
2. **UNVERIFIED** badge on every unverified rule value and on every date or amount derived from one (`verified === false`, `dependsOnUnverified`, `anyUnverified`). A page-level banner may add context but never replaces the per-value badge.
3. **Never fake data.** Every number, node, link and label in the app comes from a query. Landing and marketing show structure plus figures already quoted from rule files (marked UNVERIFIED), never invented company data. Unknown renders as `Unknown`. Synthetic demo data is labeled "Synthetic data".
4. **WCAG AA:** text 4.5:1 (use only the pairs in 1.2), non-text 3:1, a 2px blue-400 focus ring with 2px offset on everything focusable, 24px minimum target size (WCAG 2.2 AA; aim for 32px), and no information conveyed by color alone.
5. **axe-clean** on every route (existing `tests/e2e/a11y.spec.ts`, extended to new states: drawer open, palette open, tunnel mode).
6. **No horizontal overflow** at 375, 1024 and 1440 (document `scrollWidth <= innerWidth`). Wide diagrams and tables scroll inside their own container, which has a visible scroll affordance and `tabindex=0` with a label.
7. **Reduced motion** yields a complete, static, equally informative UI (section 2.3).
8. **REPLICA banners** unchanged on all replica pages.
9. **Existing `data-testid`s and accessible names are preserved**, so the current e2e suite keeps passing. If a page slice truly must change one, it lists the old and new selector in its PR notes, and slice 10 (the only owner of pre-existing spec files) applies the change.
10. **Performance:** landing initial JS under 250 KB gz; app route initial JS under 300 KB gz; LCP under 2.5s, CLS under 0.1 and INP under 200ms on the demo path (measured in slice 10).

---

## 9. Dependencies

Measured with esbuild 0.28.2 (bundle + minify, gzip -9) on 2026-11-03 for the exact import sets listed. "bp" = bundlephobia full-package figure.

| Package | Version | Status | Size (gz) | Loaded where | Why |
|---|---|---|---|---|---|
| `motion` | 14.9.0 (have ^14.7.1) | keep | `LazyMotion`+`domAnimation`+`m`+hooks: **37.0 KB measured** (`domMax` set: 48.6 KB) | app + landing, initial | springs, layoutId, pathLength draws, scroll |
| `@number-flow/react` | 0.6.2 | keep | ~8 KB (prior doc, mem) | hero numbers | money ticks |
| `cmdk` | 1.1.1 | keep | small (already shipped) | shell | palette |
| `lenis` | 1.3.27 | keep | 5.5 KB (bp) | landing only | smooth scroll, off under reduced motion |
| `recharts` | 3.10.1 | keep, forecast/eval only | heavy (~90 KB, mem): **must be route-split**; it is not imported by the shell or dashboard | forecast, eval | existing charts |
| **`ogl`** | 1.0.11 | **add** | **14.8 KB measured** | landing (lazy, after idle) | The Vault scene |
| **`d3-sankey`** | 0.12.3 | **add** | with d3-shape subset: **7.0 KB measured** | dashboard, recoveries | Sankey layout |
| **`d3-shape`** | 3.2.1 | **add** | (included above) | viz | link paths |
| `@types/d3-sankey`, `@types/d3-shape` | latest | **add (dev)** | 0 | n/a | types |
| `d3-geo` 3.1.2, `topojson-client` 3.1.0, `us-atlas` 3.0.1, `@types/d3-geo`, `@types/topojson-client` | | **add (dev only)** | 0 runtime | `scripts/gen-us-paths.ts` | precompute state paths |

**Rejected, with reasons:** `three` (138 KB gz measured minimal), `@react-three/fiber` (58 KB bp; peer `react <19.4`), `@react-three/drei` (not needed), `@splinetool/runtime` (~548 KB gz per depscope), `cobe` (6 KB, but a world globe is the wrong geography), `@xyflow/react` (60 KB bp; our graphs are static), `@visx/*` (redundant with d3-sankey/d3-shape plus our SVG), `gsap` (motion's `useScroll` covers the scroll needs; avoids a non-OSI license), Aceternity/Magic UI glow and spotlight components (the template look).

**Landing initial-JS budget (gz, estimated):** Next runtime + React 19 ≈ 110-120 KB, motion (domAnimation set) 37 KB, lenis 5.5 KB, NumberFlow ~8 KB, page code ~25 KB, for a total of **≈ 190-200 KB** against a ceiling of 250 KB. OGL plus the scene (~21 KB) loads after idle and is not counted. Slice 10 measures the real number (Playwright: the sum of JS transfer sizes before `load`, gz) and fails the build above 250 KB.

---

## 10. Work breakdown (10 slices, run in parallel after slice 1)

Rules for every slice:
- Slice 1 merges first. Slices 2-10 depend **only** on slice 1 and never import from each other's owned folders. Anything two slices need lives in slice 1's folders. If a slice needs a new shared primitive, it builds it locally inside its own folder and notes it for later promotion; it never edits slice 1 files.
- **Only slice 1 edits `package.json` / `pnpm-lock.yaml`**, and it installs every dependency in section 9 up front.
- Pre-existing files in `tests/e2e/` belong to slice 10. Each other slice writes only its own new `tests/e2e/ui-v3-<name>.spec.ts`.
- `src/lib/queries/index.ts` is not edited by anyone. New queries are imported by path (`@/lib/queries/flow`).
- Every slice runs `pnpm verify:fast`, takes Playwright screenshots of its routes at 375/1024/1440, and runs axe on them before it is done.
- Commit per slice with a conventional message on its own branch (`v3/slice-N-name`).

### Slice 1: Foundation (tokens, primitives, motion, viz core, shell). Must merge first.
Owns:
- `package.json`, `pnpm-lock.yaml`, `eslint.config.mjs` (color-ban rule)
- `src/app/globals.css`, `src/app/layout.tsx`, `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/_status/**`
- `src/app/(app)/layout.tsx`
- `src/components/ui/**`, `src/components/primitives/**`, `src/components/motion/**`, `src/components/shell/**`, `src/components/b/**`
- `src/components/viz/core/**` (new)
- `src/lib/next-action.ts` + `src/lib/next-action.test.ts` (new)
- `src/lib/ui/**`
- New tests: `tests/e2e/ui-v3-shell.spec.ts` (palette, shortcuts sheet, Loop Bar, next action, render tiers)
Deliverables: everything in sections 1, 2, 5.1-5.4 and 7; the shell in 6.0; 404 and error pages; `LifecycleRail`, `StageTrack`, `SourceChain`, `Stage3D`, `LazyCanvas`, `FlowParticles`, `useRenderTier`. Existing pages must still render after this slice merges (keep legacy token aliases like `--color-surface` until the end).
Recommended model: opus.

### Slice 2: Dashboard, Money Map, Sankey
Owns: `src/app/(app)/dashboard/**`, `src/components/viz/money-map/**`, `src/components/viz/sankey/**` (the `MoneyFlowSankey` component, with `variant` and `orientation` props; slice 6 builds its own recovery flow on `d3-sankey` directly and does not import this), `src/lib/queries/flow.ts` + `flow.test.ts`, `scripts/gen-us-paths.ts`.
New tests: `tests/e2e/ui-v3-dashboard.spec.ts`.
Deliverables: 3.2, 4.2, 6.3, 5.6 setup rail.

### Slice 3: Items, Payees, Lifecycle tunnel
Owns: `src/app/(app)/items/**`, `src/app/(app)/payees/**`, `src/components/viz/lifecycle-tunnel/**`, `src/components/viz/why-this-date/**` (a local provenance view for one date, built on `SourceChain` + d3-shape, independent of slice 5's graph).
New tests: `tests/e2e/ui-v3-items.spec.ts`.
Deliverables: 3.3, 6.4, 6.5, keyboard flows for lists.

### Slice 4: Approvals, pipeline, owner pages
Owns: `src/app/(app)/approvals/**`, `src/app/owner/**`, `src/components/viz/pipeline/**`, `src/components/viz/flip-stamp/**`, `src/lib/queries/pipeline.ts` + `pipeline.test.ts`.
New tests: `tests/e2e/ui-v3-approvals.spec.ts`.
Deliverables: 3.4, 4.3, 6.6, 6.17, the `a` / `⌘↵` / `r` / `e` keys.

### Slice 5: Rules, Reports, Replica
Owns: `src/app/(app)/rules/**`, `src/app/(app)/reports/**`, `src/app/replica/**`, `src/components/viz/provenance/**`.
New tests: `tests/e2e/ui-v3-rules-reports.spec.ts`.
Deliverables: 4.4, 6.9, 6.10, 6.16.

### Slice 6: Forecast, Activity, Recoveries
Owns: `src/app/(app)/forecast/**`, `src/app/(app)/activity/**`, `src/app/(app)/recoveries/**`, `src/components/forecast/**`, `src/components/viz/deadline-river/**`, `src/components/viz/recovery-flow/**`.
New tests: `tests/e2e/ui-v3-forecast-activity.spec.ts`.
Deliverables: 4.5, 6.7, 6.8, 6.11. (The dashboard's `DeadlineRiver` is built by slice 2 inside its own folder as a compact variant. Duplication is accepted to keep the slices independent; promote it to `viz/core` in a later cleanup.)

### Slice 7: Agents (Chat, Runs, Eval)
Owns: `src/app/(app)/chat/**`, `src/app/(app)/runs/**`, `src/app/(app)/eval/**`, `src/components/chat/**`.
New tests: `tests/e2e/ui-v3-agents.spec.ts`.
Deliverables: 6.12, 6.13, 6.14.

### Slice 8: Settings, Integrations, Login
Owns: `src/app/(app)/settings/**`, `src/app/login/**`, `src/components/viz/connection-diagram/**`.
New tests: `tests/e2e/ui-v3-settings-login.spec.ts`.
Deliverables: 6.2, 6.15 (Preferences writes the `es-motion` and lifecycle-view keys read by slice 1's hooks).

### Slice 9: Landing and marketing (The Vault)
Owns: `src/app/(marketing)/**`, `src/components/marketing/**`, `src/components/viz/vault-scene/**`, `public/marketing/**`, `scripts/render-vault-poster.ts`.
Tests: it adds `tests/e2e/ui-v3-landing.spec.ts`. The `ui-` prefix is required so the `ui` Playwright project's `testMatch` regex picks it up.
Deliverables: 3.1, 6.1, how-it-works, security; removal of Instrument Serif.

### Slice 10: Verification and budgets (starts after slices 2-9 land; its scripts can be written in parallel)
Owns: **all pre-existing files in `tests/e2e/`** (they span several slices' routes, so a single owner avoids conflicts; edits are limited to applying the selector changes that page slices list in their PR notes), plus new `tests/e2e/ui-v3-overflow.spec.ts`, `tests/e2e/ui-v3-reduced-motion.spec.ts`, `scripts/ui-v3-shots.ts`, `scripts/bundle-budget.ts`.
Deliverables: axe on every route plus open states; an overflow check at 375/1024/1440 on every route; a reduced-motion pass (`page.emulateMedia({ reducedMotion: 'reduce' })`) asserting final values render; a WebGL-disabled run on `/` asserting the poster and labels; a bundle budget (landing under 250 KB gz, app routes under 300 KB gz); screenshots at 375/768/1024/1440 for the judges' deck.

Dependency graph: `1 → {2,3,4,5,6,7,8,9} → 10`. Suggested models: slice 1 opus; 2, 3, 4 and 9 sonnet with opus review (high visibility); 5-8 sonnet; 10 sonnet.

---

## 11. Acceptance checklist (the judge's 3-minute path)

1. `/`: the poster paints immediately; The Vault comes alive within about 2s; scroll moves the camera through four steps; the disclaimer is in the footer.
2. `/login` → `/dashboard`: the number ticks, the map settles, arcs draw to CA/DE/TX, columns rise and the Sankey flows. Every figure matches `getExposure` and `getMoneyFlow`.
3. Loop Bar shows `APPROVE 2` in pink; press `.` → approvals → `⌘↵` → the flip-stamp plays and the count ticks to 1.
4. `g i` → an item → toggle `3D` → `j/k` flies through the lifecycle; "Why this date?" shows value → rule → source with an UNVERIFIED badge.
5. `g f` → file TX → the agent run drives the REPLICA portal (banner visible) → confirmation → recoveries.
6. Toggle Reduce motion in Settings: everything is static and complete.

---

## 12. References (real URLs; "fetched" = read during this research; others came from search results)

Product craft
- Linear, "How we redesigned the Linear UI": https://linear.app/now/how-we-redesigned-the-linear-ui (via prior doc)
- Linear, "Behind the latest design refresh" (fetched: attention is earned, structure felt more than seen, dimmed sidebar, fewer and smaller icons, softer separators): https://linear.app/now/behind-the-latest-design-refresh
- Vercel Geist colors (role-based scales): https://vercel.com/geist/colors
- Stripe, "To design and develop an interactive globe" (fetched: 60fps target, static-image fallback plan, antialias off for integrated GPUs, arcs revealed by draw range): https://stripe.com/blog/globe
- GitHub, "How we built the GitHub globe": https://github.blog/engineering/how-we-built-the-github-globe
- Mercury design breakdown (state first, controls second; restrained palette): https://www.925studios.co/blog/mercury-design-breakdown
- Ramp Builders (engineering blog): https://builders.ramp.com
- Raycast (keyboard as a brand motif): https://www.raycast.com/keyboard

3D options
- OGL (minimal WebGL, three-like API): https://github.com/oframe/ogl
- react-three-fiber scaling performance (on-demand frameloop, PerformanceMonitor, DPR regression): https://r3f.docs.pmnd.rs/advanced/scaling-performance
- COBE globe (5 KB WebGL, v2 arcs and CSS anchors): https://cobe.vercel.app/ and https://github.com/shuding/cobe
- Spline runtime size (~548 KB gz): https://depscope.dev/pkg/npm/@splinetool/runtime
- MDN, using CSS transforms (3D): https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_transforms/Using_CSS_transforms

Animated diagrams and motion
- Motion, React SVG animation (`pathLength`): https://motion.dev/docs/react-svg-animation
- Motion, path drawing tutorial: https://motion.dev/tutorials/react-path-drawing
- Motion, motion along a path (offsetDistance): https://examples.motion.dev/react/motion-path/tutorial
- d3-sankey: https://github.com/d3/d3-sankey
- React Graph Gallery, Sankey with d3-sankey + React rendering: https://react-graph-gallery.com/sankey-diagram
- @visx/sankey (considered, not chosen): https://npmjs.com/package/@visx/sankey
- d3-shape: https://d3js.org/d3-shape
- us-atlas (TopoJSON US states): https://github.com/topojson/us-atlas
- Lenis: https://lenis.dev/
- WCAG 2.2, Animation from Interactions: https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions

Sizes
- Bundlephobia API (three, r3f, ogl, cobe, d3-*, @xyflow/react, gsap, lenis): https://bundlephobia.com
- Local esbuild measurements: section 9 (reproduce by bundling the listed imports with `--minify` and gzip -9).
