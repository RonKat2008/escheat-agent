import { Skeleton } from "@/components/ui/skeleton";

export function HeroSkeleton() {
  return (
    <div className="grid min-h-[236px] gap-8 rounded-2xl border border-border bg-surface p-7 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" aria-busy="true" aria-label="Loading exposure">
      <div className="space-y-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-16 w-72 max-w-full" />
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-full" />
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      </div>
    </div>
  );
}

export function CardSkeleton({ rows, title }: { rows: number; title: string }) {
  return (
    <div className="rounded-[14px] border border-border bg-surface px-5 pt-4 pb-5" aria-busy="true" aria-label={`Loading ${title}`}>
      <h2 className="mb-4 text-[15px] leading-6 font-semibold text-muted-foreground">{title}</h2>
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    </div>
  );
}
