import { Skeleton } from "@/components/ui/skeleton";

export function HeroSkeleton() {
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12" aria-busy="true" aria-label="Loading exposure">
      <div>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-[72px] w-[420px] max-w-full" />
        <Skeleton className="mt-4 h-4 w-72 max-w-full" />
        <Skeleton className="mt-9 h-2 w-full" />
        <div className="mt-4 flex gap-10">
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-20" />
        </div>
      </div>
      <div className="space-y-3 lg:border-l lg:border-line lg:pl-8">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-32" />
      </div>
    </div>
  );
}

export function SectionSkeleton({ rows, title }: { rows: number; title: string }) {
  return (
    <div className="border-t border-line pt-5" aria-busy="true" aria-label={`Loading ${title}`}>
      <h2 className="mb-4 text-sm font-medium text-fg-3">{title}</h2>
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    </div>
  );
}

/** @deprecated kept for existing imports */
export const CardSkeleton = SectionSkeleton;
