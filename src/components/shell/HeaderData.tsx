import { ChevronsUpDown } from "lucide-react";
import { getCompany, upcomingDeadlines } from "@/lib/queries";
import { getCtx } from "@/lib/ui/ctx";
import { DemoClock } from "./DemoClock";

export function CompanyChip({ name = "Northwind Fixtures, Inc." }: { name?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1" title="Single demo company">
      <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-raised font-mono text-xs text-muted-foreground">
        {name.charAt(0)}
      </span>
      <span className="truncate text-sm font-medium">{name}</span>
      <span className="hidden shrink-0 rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground sm:inline">
        SYNTHETIC
      </span>
      <ChevronsUpDown className="hidden size-3.5 shrink-0 text-subtle sm:block" aria-hidden />
    </div>
  );
}

/** Company name + demo clock; reads the DB so it must render inside Suspense. */
export async function HeaderData() {
  const { db, companyId } = await getCtx();
  const [company, dl] = await Promise.all([getCompany(db, companyId), upcomingDeadlines(db, companyId, 400)]);
  const next = dl.events.find((e) => e.daysUntil > 0)?.date ?? null;
  return (
    <>
      <div className="min-w-0 flex-1 lg:flex-none">
        <CompanyChip name={company.name} />
      </div>
      <div className="hidden flex-1 justify-center lg:flex">
        <PaletteSlot />
      </div>
      <DemoClock today={dl.asOf} nextDeadline={next} />
    </>
  );
}

import { PaletteTrigger } from "./CommandPalette";
function PaletteSlot() {
  return <PaletteTrigger />;
}

export function HeaderFallback() {
  return (
    <>
      <div className="min-w-0 flex-1 lg:flex-none">
        <CompanyChip />
      </div>
      <div className="hidden flex-1 justify-center lg:flex">
        <PaletteSlot />
      </div>
      <div className="h-8 w-40 animate-pulse rounded-lg bg-raised" aria-hidden />
    </>
  );
}
