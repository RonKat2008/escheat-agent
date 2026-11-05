import { Suspense, type ReactNode } from "react";
import { ChevronsUpDown } from "lucide-react";
import { countWaiting } from "@/app/(app)/approvals/queue-count";
import { getCompany, upcomingDeadlines } from "@/lib/queries";
import { getCtx } from "@/lib/ui/ctx";
import { SyntheticChip } from "@/components/primitives";
import { PaletteTrigger } from "./CommandPalette";
import { DemoClock } from "./DemoClock";
import { MobileNav } from "./MobileNav";
import { SectionNav } from "./SectionNav";
import { SideNav } from "./SideNav";
import { TourButton } from "@/components/tour/TourButton";

/** Workspace row at the top of the menu sheet. Single demo company, so it is informational. */
export function CompanyChip({ name = "Northwind Fixtures, Inc." }: { name?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-full border border-line bg-fg-1/[0.04] py-1.5 pr-2.5 pl-1.5" title="Single demo company">
      <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-fg-1/[0.08] text-[11px] font-medium text-fg-1">
        {name.charAt(0)}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg-1">{name}</span>
      <ChevronsUpDown className="size-3.5 shrink-0 text-fg-3" strokeWidth={1.5} aria-hidden />
    </div>
  );
}

type Ctx = Awaited<ReturnType<typeof getCtx>>;

/** Everything waiting for a human: the coral Approvals count in every nav. Same definition as the Approvals list header. */
function approvalsWaiting({ db, companyId }: Ctx): Promise<number> {
  return countWaiting(db, companyId);
}

/** Menu sheet body: company + grouped nav with the approvals count. Reads the DB, so render inside Suspense. */
export async function SidebarData() {
  const ctx = await getCtx();
  const [company, waiting] = await Promise.all([getCompany(ctx.db, ctx.companyId), approvalsWaiting(ctx)]);
  return (
    <>
      <div className="mb-5 group-data-[collapsed=true]/shell:hidden">
        <CompanyChip name={company.name} />
      </div>
      <SideNav counts={{ "/approvals": waiting }} />
    </>
  );
}

export function SidebarFallback() {
  return (
    <>
      <div className="mb-5 group-data-[collapsed=true]/shell:hidden">
        <CompanyChip />
      </div>
      <Suspense fallback={null}>
        <SideNav />
      </Suspense>
    </>
  );
}

/**
 * The right end of the floating top bar: the demo marker, round glass search and tour buttons, the solid cream clock,
 * then the round glass menu (the reference's ☰), which opens every page as a sheet at any width.
 */
function TopBarTools({ clock, counts }: { clock: ReactNode; counts?: Record<string, number> }) {
  return (
    <div className="flex min-w-0 items-center justify-end gap-1.5 justify-self-end">
      <SyntheticChip className="mr-1 hidden sm:inline-flex" />
      <PaletteTrigger />
      <TourButton />
      {clock}
      <MobileNav counts={counts} />
    </div>
  );
}

/**
 * Top bar body (V4 §5): the centred pill nav (≥1024px) and the right-hand tools. Two grid children of the bar, so the
 * pill nav lands in the bar's middle column. Reads the DB so it must render inside Suspense.
 */
export async function HeaderData() {
  const ctx = await getCtx();
  const [dl, waiting] = await Promise.all([upcomingDeadlines(ctx.db, ctx.companyId, 400), approvalsWaiting(ctx)]);
  const next = dl.events.find((e) => e.daysUntil > 0)?.date ?? null;
  return (
    <>
      <SectionNav counts={{ "/approvals": waiting }} className="hidden justify-self-center lg:block" />
      <TopBarTools clock={<DemoClock today={dl.asOf} nextDeadline={next} />} counts={{ "/approvals": waiting }} />
    </>
  );
}

export function HeaderFallback() {
  return (
    <>
      <Suspense fallback={null}>
        <SectionNav className="hidden justify-self-center lg:block" />
      </Suspense>
      <TopBarTools clock={<div className="h-9 w-28 animate-pulse rounded-full bg-fg-1/[0.06]" aria-hidden />} />
    </>
  );
}
