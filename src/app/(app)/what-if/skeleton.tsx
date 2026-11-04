export function WhatIfSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading the what-if simulator">
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-[12px] border border-line bg-ink-2 motion-reduce:animate-none" />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-[14px] border border-line bg-ink-2 motion-reduce:animate-none" />
      <div className="h-40 animate-pulse rounded-[10px] border border-line bg-ink-2 motion-reduce:animate-none" />
    </div>
  );
}
