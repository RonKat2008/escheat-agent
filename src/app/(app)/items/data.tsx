import { Suspense } from "react";
import { CLOSED_STATUSES, findStaleItemId, explainItem, getOverdue, listStaleItems, type ListFilters } from "@/lib/queries";
import { getCtx } from "@/lib/ui/ctx";
import { ItemsClient } from "./items-client";
import { DrawerBody } from "./drawer-content";
import { loadItemsParams } from "./params";
import { filterByView, stateRibbon, viewCounts } from "./view-model";
import { getViewMembership } from "./views";
import type { IsoDate } from "@/lib/dates";

export async function ItemsData({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = loadItemsParams(await searchParams);
  const { db, companyId } = await getCtx();
  // The state filter runs here, after the list, so the state ribbon can show every state as a filter choice.
  const filters: ListFilters = {
    limit: 500,
    sort: p.sort ?? "age_desc",
    ...(p.status ? { status: p.status } : {}),
    ...(p.type ? { propertyType: p.type } : {}),
    ...(p.minAge ? { minAgeDays: p.minAge } : {}),
    ...(p.review ? { needsReview: true } : {}),
    ...(p.q ? { search: p.q } : {}),
    ...(p.status && (CLOSED_STATUSES as readonly string[]).includes(p.status) ? { includeClosed: true } : {}),
  };
  const [list, overdue] = await Promise.all([listStaleItems(db, companyId, filters), getOverdue(db, companyId)]);
  const sets = await getViewMembership(db, companyId, list.asOf as IsoDate);
  // The Overdue filter reuses the shared overdue assessment (src/lib/overdue.ts); it never compares dates itself.
  const base = p.overdue ? list.items.filter((r) => overdue.flags[r.id]?.state === "overdue") : list.items;
  const counts = viewCounts(p.state ? base.filter((r) => r.ownerState === p.state) : base, sets, list.asOf);
  const inView = filterByView(base, p.view ?? "all", sets, list.asOf);
  const ribbon = stateRibbon(inView);
  const rows = p.state ? inView.filter((r) => r.ownerState === p.state) : inView;
  const narrowed = Boolean(p.overdue || p.state || (p.view && p.view !== "all"));
  const drawerId = p.item ? await findStaleItemId(db, companyId, p.item) : null;
  return (
    <ItemsClient
      rows={rows}
      total={narrowed ? rows.length : list.total}
      overdue={overdue.flags}
      overdueCount={overdue.count}
      asOf={list.asOf}
      viewCounts={counts}
      ribbon={ribbon}
      drawerItemId={drawerId}
      drawer={drawerId ? <Suspense fallback={<DrawerSkeleton />}><DrawerData id={drawerId} /></Suspense> : null}
    />
  );
}

async function DrawerData({ id }: { id: string }) {
  const { db } = await getCtx();
  const ex = await explainItem(db, id);
  return <DrawerBody ex={ex} />;
}

/** Same blocks as the drawer body (header, owner, timeline rail), so the content lands without a jump. */
function DrawerSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading item">
      <div className="space-y-2.5 px-5 pt-5 pb-5">
        <div className="h-4 w-40 animate-pulse rounded bg-ink-3/70" />
        <div className="h-6 w-56 animate-pulse rounded bg-ink-3/70" />
        <div className="h-7 w-32 animate-pulse rounded bg-ink-3/70" />
      </div>
      <div className="space-y-2.5 border-t border-line px-5 py-5">
        <div className="h-4 w-28 animate-pulse rounded bg-ink-3/70" />
        <div className="h-4 w-full animate-pulse rounded bg-ink-3/70" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-ink-3/70" />
      </div>
      <div className="border-t border-line px-5 py-5">
        <div className="mb-4 h-4 w-20 animate-pulse rounded bg-ink-3/70" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 pb-5">
            <div className="mt-1 size-2 justify-self-center rounded-full bg-ink-3" />
            <div className="space-y-1.5">
              <div className="h-3.5 w-2/3 animate-pulse rounded bg-ink-3/70" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-ink-3/50" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
