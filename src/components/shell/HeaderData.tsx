import { Suspense, type ReactNode } from "react";
import { ChevronsUpDown } from "lucide-react";
import { countWaiting } from "@/app/(app)/approvals/queue-count";
import { getCompany, upcomingDeadlines } from "@/lib/queries";
import { getCtx } from "@/lib/ui/ctx";
import { SyntheticChip } from "@/components/primitives";
import { PaletteTrigger } from "./CommandPalette";
import { DemoClock } from "./DemoClock";
import { Brand } from "./Brand";
import { HideInAsk } from "./HideInAsk";
import { MobileNav } from "./MobileNav";
import { ModeSwitch } from "./ModeSwitch";
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
      {/* The mode switch took the room: the chip shows here from 1280px and in the footer below that. */}
      <SyntheticChip className="mr-1 hidden xl:inline-flex" />
      {/* Below 640px the bar keeps brand, mode switch, tour, clock and ☰ (⌘K still opens the palette). */}
      <span className="hidden sm:contents">
        <PaletteTrigger />
      </span>
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
      <BrandGroup switch={<ModeSwitch waiting={waiting} />} />
      {/* Ask mode has no section nav (calm); the empty slot keeps the bar's centre column. The ☰ sheet still lists every page. */}
      <HideInAsk fallback={NAV_SLOT}>
        <SectionNav counts={{ "/approvals": waiting }} className="hidden justify-self-center lg:block" />
      </HideInAsk>
      <TopBarTools clock={<DemoClock today={dl.asOf} nextDeadline={next} />} counts={{ "/approvals": waiting }} />
    </>
  );
}

const NAV_SLOT = <div aria-hidden className="hidden lg:block" />;

/**
 * The bar's first column: the brand, then the Ask / Dashboard mode switch (ASK-MODE §1.2) at every width. The switch's
 * Dashboard segment carries the coral approvals count, so it stays visible from Ask.
 */
function BrandGroup({ switch: modeSwitch }: { switch: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 justify-self-start sm:gap-3">
      <Brand className="min-w-0 shrink-0 max-xl:relative max-xl:-m-[3px] max-xl:min-h-6 max-xl:min-w-6 max-xl:justify-center max-xl:after:absolute max-xl:after:-inset-2.5 max-xl:after:content-['']" textClassName="hidden text-[15px] font-medium tracking-[-0.02em] text-fg-1 xl:inline" />
      {modeSwitch}
    </div>
  );
}

export function HeaderFallback() {
  return (
    <>
      <BrandGroup
        switch={
          <Suspense fallback={<div aria-hidden className="glass-pill h-9 w-[142px] shrink-0" />}>
            <ModeSwitch />
          </Suspense>
        }
      />
      <Suspense fallback={null}>
        <HideInAsk fallback={NAV_SLOT}>
          <SectionNav className="hidden justify-self-center lg:block" />
        </HideInAsk>
      </Suspense>
      <TopBarTools clock={<div className="h-9 w-28 animate-pulse rounded-full bg-fg-1/[0.06]" aria-hidden />} />
    </>
  );
}
