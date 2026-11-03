import { Skeleton } from "@/components/ui/skeleton";

/** Fixed pseudo-heights so the placeholder bars look like a chart without implying any value. */
const BAR_HEIGHTS = [38, 26, 14, 20, 0, 72, 22, 48, 8, 52, 0, 0, 6, 0, 0, 18, 24, 56];

/**
 * Mirrors the loaded layout block for block (filter row, window line, banner, stat strip, chart section, table) at the
 * same heights, so swapping in the real content does not move anything below it.
 */
export function ForecastSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading forecast" className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-8 w-[190px]" />
          <Skeleton className="h-8 w-[222px]" />
        </div>
        <Skeleton className="h-8 w-36" />
      </div>
      <Skeleton className="-mt-6 h-4 w-[min(640px,100%)]" />
      <Skeleton className="h-[42px] w-full rounded-[10px]" />
      <div className="grid grid-cols-2 gap-y-6 border-t border-line pt-5 lg:grid-cols-[1.25fr_1.25fr_1fr_1fr]">
        {[true, true, false, false].map((lead, i) => (
          <div key={i} className="space-y-2 pr-4 lg:px-6 lg:first:pl-0">
            <Skeleton className="h-3 w-32 max-w-full" />
            <Skeleton className={lead ? "h-8 w-28" : "h-7 w-12"} />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="border-t border-line pt-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="h-8 w-[232px]" />
        </div>
        <div className="flex h-[240px] items-end gap-[1.5%] border-b border-line pl-12 sm:h-[280px]">
          {BAR_HEIGHTS.map((h, i) => (
            <Skeleton key={i} className="flex-1 rounded-b-none bg-ink-3/50" style={{ height: `${Math.max(h, 1)}%` }} />
          ))}
        </div>
        <Skeleton className="mt-3 h-3 w-60" />
      </div>
      <div className="border-t border-line pt-5">
        <Skeleton className="mb-4 h-4 w-48" />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex h-14 items-center gap-6 border-b border-line">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-8" />
            <Skeleton className="ml-auto h-3 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
