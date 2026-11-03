import { Skeleton } from "@/components/ui/skeleton";

export function ItemsSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading items">
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-16" />
      </div>
      <div>
        <div className="flex h-9 items-center gap-6 border-b border-line px-3">
          <Skeleton className="h-3.5 w-3.5 rounded-[3px]" />
          <Skeleton className="h-2.5 w-14" />
          <Skeleton className="ml-auto h-2.5 w-12" />
          <Skeleton className="hidden h-2.5 w-20 md:block" />
          <Skeleton className="hidden h-2.5 w-12 sm:block" />
        </div>
        {Array.from({ length: 14 }, (_, i) => (
          <div key={i} className="flex h-10 items-center gap-6 border-b border-line px-3">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-44" />
            <Skeleton className="h-3 w-6" />
            <Skeleton className="ml-auto h-3 w-16" />
            <Skeleton className="hidden h-3 w-28 md:block" />
            <Skeleton className="hidden h-3 w-20 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
