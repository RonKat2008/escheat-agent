import { Suspense } from "react";
import { and, count, eq, inArray } from "drizzle-orm";
import { ChevronsUpDown } from "lucide-react";
import { outreach } from "@/db/schema";
import { getCompany, upcomingDeadlines } from "@/lib/queries";
import { getCtx } from "@/lib/ui/ctx";
import { DemoMarker } from "@/components/primitives";
import { PaletteTrigger } from "./CommandPalette";
import { DemoClock } from "./DemoClock";
import { SideNav } from "./SideNav";

/** Workspace row at the top of the sidebar. Single demo company, so it is informational. */
export function CompanyChip({ name = "Northwind Fixtures, Inc." }: { name?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-md px-2.5 py-1.5" title="Single demo company">
      <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-ink-3 text-[11px] font-medium text-fg-2">
        {name.charAt(0)}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg-1">{name}</span>
      <ChevronsUpDown className="size-3.5 shrink-0 text-fg-3" strokeWidth={1.5} aria-hidden />
    </div>
  );
}

/** Sidebar body: company + grouped nav with the approvals count. Reads the DB, so render inside Suspense. */
export async function SidebarData() {
  const { db, companyId } = await getCtx();
  const [company, waiting] = await Promise.all([
    getCompany(db, companyId),
    db
      .select({ n: count() })
      .from(outreach)
      .where(and(eq(outreach.companyId, companyId), inArray(outreach.status, ["draft", "awaiting_approval"]))),
  ]);
  return (
    <>
      <div className="mb-5">
        <CompanyChip name={company.name} />
      </div>
      <SideNav counts={{ "/approvals": waiting[0]?.n ?? 0 }} />
    </>
  );
}

export function SidebarFallback() {
  return (
    <>
      <div className="mb-5">
        <CompanyChip />
      </div>
      <Suspense fallback={null}>
        <SideNav />
      </Suspense>
    </>
  );
}

/** Top bar: search, demo clock, the one demo marker. Reads the DB so it must render inside Suspense. */
export async function HeaderData() {
  const { db, companyId } = await getCtx();
  const dl = await upcomingDeadlines(db, companyId, 400);
  const next = dl.events.find((e) => e.daysUntil > 0)?.date ?? null;
  return (
    <>
      <div className="hidden min-w-0 flex-1 md:flex">
        <PaletteTrigger />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <DemoClock today={dl.asOf} nextDeadline={next} />
        <DemoMarker className="hidden sm:inline-flex" />
      </div>
    </>
  );
}

export function HeaderFallback() {
  return (
    <>
      <div className="hidden min-w-0 flex-1 md:flex">
        <PaletteTrigger />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <div className="h-8 w-32 animate-pulse rounded-md bg-ink-3/70" aria-hidden />
        <DemoMarker className="hidden sm:inline-flex" />
      </div>
    </>
  );
}
