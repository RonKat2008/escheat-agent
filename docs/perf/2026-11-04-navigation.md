# In-app navigation speed (2026-11-04)

Ask: "make the time between pages faster." Scope: client-side navigation between the app routes under
`src/app/(app)/`. There is no `/audit`, `/ledger` or `/horizon` route in this tree. `/settings` is a 307 route handler
to `/settings/integrations`, so the nav already links straight to `/settings/integrations`. `/close-out/[state]` is not
in the nav, so only its server time is measured.

## How it was measured

Production build only (`next build` + `next start`). `next dev` compiles on demand and says nothing about shipped
navigation. Each build ran through `scripts/e2e-perf-server.ts` with its own seeded PGlite dir (`DEMO_ANCHOR_DATE=2026-11-01`,
offline keys, passcode gate on).

`scripts/measure-nav.ts <baseURL> [rounds]` (kept in the repo):

- **Click → h1**: from the click (capture-phase `performance.now()` in the page) until `main h1` shows the new page's
  title. Timed with a MutationObserver inside the page, so Playwright's own overhead is not counted.
- **Click → content**: until no `aria-busy="true"` skeleton is left in `<main>`. This is the number a person feels.
- **Skeleton shown**: in how many of the rounds a skeleton was on screen at some point.
- **Server TTFB / full render**: a plain `GET` with the session cookie. TTFB is the static shell flush. Full render is
  the last streamed byte, so it includes every DB-backed hole (layout included).

Sidebar at 1440×900, clicking through the nav in order. Medians over 5 rounds.

The laptop was shared with several other agents running builds and e2e suites, so absolute numbers move with machine
load. That is why the comparison below interleaves the two builds (before, after, before, after) on the same machine
within the same few minutes. The load average was about 25 falling to 12 during that run. An earlier pair taken at a
load average of about 60 is also included.

## What the time was going to

1. **React's Suspense reveal throttle (the big one).** Every page streams its data behind a skeleton. Once a fallback
   commits, React holds the content behind it for 300 ms (`FALLBACK_THROTTLE_MS`). Partial prefetching made the skeleton
   commit at about 25 ms, so a page whose data arrived at 60 ms still painted its content at about 330 ms. The pages that
   hit this (dashboard, forecast, activity, eval, and anything slow under load) sat at a 320-375 ms floor no matter how
   fast the server was. Confirmed in `next/dist/compiled/react-dom` (`globalMostRecentFallbackTime + 300 - now()`)
   and in timings. The RSC payload for `/runs` finished in 30 ms while the content painted at about 310 ms.
2. **Duplicate reads inside one render.** The dashboard read the open stale-item rows 3 or 4 times and ran the overdue
   assessment 2 or 3 times (its own call, plus the Loop Bar triage via `getNeedsActionIds`). Forecast ran every open item
   through the rules engine twice (`getForecast` and `getCalendarExtras` each called `loadForecastInputs`). PGlite runs
   single-threaded in process, so `Promise.all` cannot overlap them. Each duplicate adds directly to the total.

Checked and **not** the problem:

- **Prefetch.** Sidebar links are `next/link`, and the page shells are prefetched (`partialPrefetching`). The h1 appeared
  at about 25 ms in the baseline.
- **Missing `loading.tsx`.** Every route already has a page-level Suspense with a layout-matched skeleton. Adding
  `loading.tsx` to the other 7 routes would add more skeleton commits, and every skeleton commit triggers the 300 ms
  throttle. So I did not add them.
- **The layout blocking on data.** Every layout read (sidebar count, header clock, Loop Bar) is already behind its own
  Suspense. Client navigations do not re-render the layout.
- **Heavy client components.** The 3D lifecycle tunnel, the item drawer and the bulk dialogs are already `next/dynamic`.
- **Server render time.** The RSC payload for one page is 20-170 ms. That is not the floor.

## What changed

- **Skeleton hold** (`src/components/shell/nav-hold.ts`, `NavHold.tsx`). Every page skeleton is wrapped in `<NavHold>`,
  both the Suspense fallbacks and the `loading.tsx` bodies. During a client navigation the fallback itself suspends for
  up to `NAV_HOLD_MS` (450 ms) from the click. Inside the router's transition, the current page stays up until the new
  one is ready, and then it commits once, complete, with no skeleton and no throttle.
  - A page slower than 450 ms shows its skeleton exactly as before.
  - Hard loads and hydration never hold: the skeleton is still the server HTML, so CLS is unchanged.
  - The hold ends the moment the new URL commits, so later skeletons (a drawer, a nested boundary) render at once.
- **Route-transition hairline** (`NavProgress.tsx`, CSS in `globals.css`). A 2 px electric-blue (`--color-blue-500`)
  bar at the top of the window while a navigation is in flight.
  - It fades in only after 120 ms, so fast navigations never flash it.
  - It animates with transform and opacity only. Under reduced motion it is a static bar with no sweep.
  - It is `aria-hidden`.
  - The same component marks navigations for the hold: internal link clicks (capture phase), back/forward, and the
    palette, `g`-shortcut and next-action `router.push` calls via `markNavigationTo`.
- **Per-render dedupe of shared reads** with React `cache()`:
  - `loadOpenRows`
  - company-wide `getOverdue`
  - `loadForecastInputs`

  The scope is one RSC render: nothing is shared across requests, so a demo-clock change or an approval is visible on
  the next render. Outside a render (server actions, route handlers, chat tools, scripts, tests) they are plain calls.
  `src/lib/queries/render-dedupe.test.ts` pins this: a clock advance or status change shows on the very next call.

- **Next-action pill name (found by the new spec).** At xl, the pill shows a "Press ." hint (added in `a7abcfe`) that
  was not part of its `aria-label`. That failed axe `label-content-name-mismatch` at 1440 on every app page, including
  the existing `ui-v3-foundation` and `ui-tour` axe checks. The pill now takes its name from its content: an sr-only
  "Next action:" prefix followed by the visible text. The shortcut is still announced through `aria-keyshortcuts`.

## Before / after

### Interleaved A/B, same machine, load average about 25 to 12 (final code)

Before (baseline build, `a7abcfe`):

| Route | Click → h1 (ms) | Click → content (ms) | Skeleton shown | Server TTFB (ms) | Server full render (ms) |
|---|---:|---:|---:|---:|---:|
| /dashboard | 21 | 336 | 5/5 | 7 | 89 |
| /items | 29 | 108 | 5/5 | 5 | 65 |
| /payees | 45 | 57 | 5/5 | 5 | 57 |
| /approvals | 26 | 96 | 5/5 | 5 | 72 |
| /forecast | 36 | 375 | 5/5 | 6 | 125 |
| /activity | 34 | 320 | 5/5 | 6 | 92 |
| /rules | 43 | 46 | 1/5 | 5 | 70 |
| /reports | 23 | 31 | 5/5 | 5 | 49 |
| /recoveries | 25 | 29 | 5/5 | 5 | 45 |
| /chat | 27 | 27 | 0/5 | 5 | 42 |
| /runs | 25 | 30 | 5/5 | 5 | 43 |
| /eval | 24 | 333 | 5/5 | 5 | 44 |
| /settings/integrations | 26 | 35 | 5/5 | 5 | 37 |
| /close-out/CA | n/a (not in nav) | n/a | n/a | 5 | 52 |

Before, median click → content: 42-52 ms over the two passes. Max: 398-403 ms. Throttled pages: 320-375 ms.

After:

| Route | Click → h1 (ms) | Click → content (ms) | Skeleton shown | Server TTFB (ms) | Server full render (ms) |
|---|---:|---:|---:|---:|---:|
| /dashboard | 115 | 115 | 0/5 | 6 | 112 |
| /items | 95 | 96 | 0/5 | 5 | 80 |
| /payees | 73 | 73 | 0/5 | 7 | 65 |
| /approvals | 60 | 60 | 0/5 | 7 | 71 |
| /forecast | 133 | 133 | 0/5 | 7 | 99 |
| /activity | 102 | 102 | 0/5 | 5 | 105 |
| /rules | 47 | 48 | 0/5 | 7 | 75 |
| /reports | 39 | 39 | 0/5 | 6 | 57 |
| /recoveries | 32 | 33 | 0/5 | 5 | 48 |
| /chat | 29 | 29 | 0/5 | 6 | 48 |
| /runs | 31 | 31 | 0/5 | 6 | 58 |
| /eval | 49 | 49 | 0/5 | 5 | 60 |
| /settings/integrations | 47 | 47 | 0/5 | 7 | 52 |
| /close-out/CA | n/a (not in nav) | n/a | n/a | 6 | 64 |

After, median click → content: 54-69 ms over the two passes. Max: 250-324 ms. No skeleton flash in any of 130
navigations.

### Under heavy load (load average about 60, before the query dedupe landed)

| | Median click → h1 | Median click → content | Max click → content |
|---|---:|---:|---:|
| Before | 29 ms | 318 ms | 689 ms |
| After (hold + hairline only) | 110 ms | 110 ms | 818 ms (one dashboard round that ran past the hold) |

### Reading the numbers

- **What got faster.** Pages that used to hit the throttle got about 3x faster to complete content:
  - dashboard: 336 → 115 ms
  - forecast: 375 → 133 ms
  - activity: 320 → 102 ms
  - eval: 333 → 49 ms

  Every navigation now paints once, complete, instead of skeleton-then-content. The worst case dropped from about
  400 ms to 250-324 ms on a quiet machine.
- **The cost.** The new title no longer appears at about 25 ms: the h1 now appears with the content. The hairline
  covers that gap. On a quiet machine, already-fast pages (items, payees, reports, settings) gained 10-50 ms. Those
  pages used to show a skeleton for a frame or two and then the content. Now there is one commit of the whole page.
- **On a loaded machine** (closer to a slow laptop or a busy server), the median went from 318 to 110 ms. Skeletons
  only appear when a page needs more than 450 ms.

## Not done, and why

- **`'use cache'` + `cacheTag` on DB reads.** Every read depends on the demo clock and on approvals and status changes,
  which many server actions write. Cross-request caching would need a tag on every write path to stay correct.
  The measured server time (20-170 ms per page payload) does not justify that risk. Per-render dedupe gets the safe part.
- **More `loading.tsx` files.** Measured to make things worse (see above). Every route already has a matching skeleton.
- **Runtime prefetch of dynamic data** (`unstable_prefetch`). Would make even the first paint instant. But it prefetches
  personalised, fast-changing data for 13 links on every page, and it is experimental in Next 16.
- **Tour components.** Untouched (owned by another agent).

## Reproduce

```bash
E2E_DIR_SUFFIX=-nav E2E_PERF_DIST=.next-e2e-perf-nav tsx scripts/e2e-perf-server.ts --build-only 3941
E2E_DIR_SUFFIX=-nav E2E_PERF_PREBUILT=.next-e2e-perf-nav tsx scripts/e2e-perf-server.ts 3941 &
tsx scripts/measure-nav.ts http://localhost:3941 5
```
