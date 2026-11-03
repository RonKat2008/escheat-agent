import { Skeleton } from "@/components/ui/skeleton";

export function PayeesSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading payees">
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="border-t border-line">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="flex h-12 items-center gap-6 border-b border-line px-3">
            <Skeleton className="h-3 w-48" />
            <Skeleton className="ml-auto h-3 w-16" />
            <Skeleton className="hidden h-3 w-24 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
