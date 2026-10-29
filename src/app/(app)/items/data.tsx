import { Suspense } from "react";
import { CLOSED_STATUSES, findStaleItemId, explainItem, listStaleItems, type ListFilters } from "@/lib/queries";
import { getCtx } from "@/lib/ui/ctx";
import { ItemsClient } from "./items-client";
import { DrawerBody } from "./drawer-content";
import { loadItemsParams } from "./params";

export async function ItemsData({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = loadItemsParams(await searchParams);
  const { db, companyId } = await getCtx();
  const filters: ListFilters = {
    limit: 500,
    sort: p.sort ?? "age_desc",
    ...(p.state ? { state: p.state.slice(0, 2) } : {}),
    ...(p.status ? { status: p.status as ListFilters["status"] } : {}),
    ...(p.type ? { propertyType: p.type as ListFilters["propertyType"] } : {}),
    ...(p.minAge ? { minAgeDays: p.minAge } : {}),
    ...(p.review ? { needsReview: true } : {}),
    ...(p.q ? { search: p.q } : {}),
    ...(p.status && (CLOSED_STATUSES as readonly string[]).includes(p.status) ? { includeClosed: true } : {}),
  };
  const list = await listStaleItems(db, companyId, filters);
  const drawerId = p.item ? await findStaleItemId(db, companyId, p.item) : null;
  return (
    <ItemsClient
      rows={list.items}
      total={list.total}
      asOf={list.asOf}
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

function DrawerSkeleton() {
  return (
    <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading item">
      <div className="h-6 w-48 animate-pulse rounded bg-raised" />
      <div className="h-4 w-72 animate-pulse rounded bg-raised" />
      <div className="h-64 animate-pulse rounded-xl bg-raised" />
    </div>
  );
}
