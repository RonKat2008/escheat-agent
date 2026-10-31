import { Skeleton } from "@/components/ui/skeleton";

export function RulesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading rules" className="space-y-6">
      <div className="flex gap-6 border-b border-line pb-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-11 w-full" />
      <div className="space-y-0">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="flex h-10 items-center gap-6 border-b border-line">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
