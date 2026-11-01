import { Skeleton } from "@/components/ui/skeleton";

export function ForecastSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading forecast" className="space-y-10">
      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-8 w-44" />
        </div>
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="grid grid-cols-2 gap-6 border-y border-line py-5 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-6 w-24" />
          </div>
        ))}
      </div>
      <Skeleton className="h-[280px] w-full" />
    </div>
  );
}
