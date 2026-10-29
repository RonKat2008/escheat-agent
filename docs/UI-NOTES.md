# UI notes (lane A -> lane B)

## Route groups (IMPORTANT)
App pages live under `src/app/(app)/...` (URLs unchanged). The `(app)/layout.tsx` renders the shell (nav, header, demo clock, footer disclaimer).
`/replica/**`, `/owner/**`, `/login` stay OUTSIDE the group and get only the bare root layout.
Lane B: put /approvals, /reports, /recoveries, /runs, /eval under `src/app/(app)/<route>/` (they were moved there already as placeholders; edit in place). Do NOT create `src/app/<route>/page.tsx` outside the group (duplicate-route build error).

## Shared primitives (src/components/)
Import from `@/components/primitives` (barrel): StatusPill, StatusDot, STATUS_META, UnverifiedBadge, UnknownBadge, Money, DateCell, PageHeader, EmptyState, ErrorState, SectionCard, KpiStat, SourceLink, PrototypePill.
- Page pattern: `<PageHeader title description actions/>`, content in `<SectionCard title>`; data in async Server Components inside `<Suspense fallback={<Skeleton/>}>`; add `error.tsx` per route using `<ErrorState>`.
- Tokens: use Tailwind `bg-surface`, `bg-raised`, `text-muted-foreground`, `text-at-risk` (amber), `text-resolved` (green), `text-danger`, `text-sky`, `text-slate`, `bg-sunken`. Amber only for risk/awaiting-you, green only for resolved.
- Deep links: `/items?item=<staleItemId>`.
