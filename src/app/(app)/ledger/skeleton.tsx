import { Skeleton } from "@/components/ui/skeleton";

export const LEDGER_DESCRIPTION = "Close the books on unclaimed property: the liability roll-forward by owner state and the journal entries behind it.";

/** Placeholder with the page's final shape (chips, headline + waterfall, tables), so nothing jumps when data lands. */
export function LedgerSkeleton() {
  return (
    <div className="space-y-12" aria-hidden>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-8 w-80 max-w-full" />
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="-mt-6 grid gap-x-10 gap-y-8 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-14 w-64 max-w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-6 w-28" />
        </div>
        <Skeleton className="h-[360px] lg:col-span-7" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
