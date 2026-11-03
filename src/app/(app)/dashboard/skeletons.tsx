import { Skeleton } from "@/components/ui/skeleton";

/**
 * The whole dashboard's loading state: the hero's two columns, then a block for the Sankey and the lists. Deliberately
 * taller than any viewport (min-h) so the footer starts below the fold and the content swap shifts nothing visible.
 */
export function DashboardSkeleton() {
  return (
    <div className="min-h-[1500px]" role="status" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-3 h-[64px] w-[380px] max-w-full" />
          <Skeleton className="mt-4 h-4 w-72 max-w-full" />
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
          <Skeleton className="mt-8 h-56 w-full rounded-[10px]" />
        </div>
        <div className="lg:col-span-7">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="mt-6 aspect-[16/11] w-full rounded-[14px]" />
        </div>
      </div>
      <Skeleton className="mt-14 h-4 w-32" />
      <Skeleton className="mt-5 h-[352px] w-full rounded-[10px]" />
    </div>
  );
}
