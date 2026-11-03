# V3 follow-ups (orchestrator notes, 2026-11-03)

- **Sidebar hydration mismatch (seen in ui-close-out e2e):** the server-rendered SideNav marked `/reports` as `aria-current="page"` while the client pathname was `/chat`, which caused "Hydration failed". The tree regenerates on the client, so the tests pass, but the console is noisy. Suspect: a cached shell segment under cacheComponents rendered for another route, or a navigation during hydration. Investigate in slice 10.
- **Landing initial JS is 294.6 KB gz (budget 250).** About 240 KB is the root layout (React/Next + sonner + the tooltip provider). Options: lazy-load sonner and the tooltip provider in the root layout, and drop motion from marketing (replace DrawPath with CSS). Slice 10.
- **ClosePlan links** now add `kind` and `state`, but the Approvals page reads only `sel`. Slice 4 should honor `?kind=` and `?state=`.
- **Agents e2e project** pattern `/agents\.spec\.ts$/` also matches `ui-v3-agents.spec.ts` (skip guard inside the spec). Narrow it in playwright.config.ts (slice 10).
- **"Next legal date" disagrees with the lifecycle rail** (dashboard Featured check #10482): the card says Oct 31, 2028 (DD window opens) while the rail marks Presumed abandoned (Sep 1, 2028) as NEXT. Pick one definition of "next legal date" and use it in both.
- **Drawer shows "LIFECYCLE" twice** (drawer heading + rail caption).
- **No outreach reject endpoint**, so the `r` key in Approvals is not wired.
