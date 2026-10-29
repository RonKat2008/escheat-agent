import { Skeleton } from "@/components/ui/skeleton";

export function ItemsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading items">
      <div className="mb-3 flex flex-wrap gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="overflow-hidden rounded-[12px] border border-border bg-surface">
        <Skeleton className="h-9 rounded-none" />
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="flex h-9 items-center gap-4 border-t border-border px-3">
            <Skeleton className="h-3.5 w-14" />
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="ml-auto h-3.5 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
