import { Skeleton } from "@/components/ui/skeleton";

export function ItemsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading items">
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-16" />
      </div>
      <div className="border-t border-line">
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
