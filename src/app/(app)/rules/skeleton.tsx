import { Skeleton } from "@/components/ui/skeleton";

export function RulesSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading rules" className="space-y-4">
      <div className="flex gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="rounded-[12px] border border-border bg-surface p-4">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="my-3 h-5 w-full" />
        ))}
      </div>
    </div>
  );
}
