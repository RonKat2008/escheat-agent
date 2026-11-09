/** Ask's loading state: the same headline and composer footprint as AskHero, so nothing moves when it resolves. */
export function AskSkeleton() {
  return (
    <div className="mx-auto grid min-h-[60dvh] w-full max-w-[1120px] content-center gap-x-12 gap-y-10 pt-14 pb-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-center" role="status" aria-busy="true" aria-label="Loading Ask">
      <div className="min-w-0">
        <p className="type-display text-[44px] text-balance sm:text-[60px] lg:text-[72px]" aria-hidden>
          What do you want
          <br /> to get done?
        </p>
        <div className="mt-4 h-5 w-full max-w-[56ch] animate-pulse rounded-full bg-fg-1/[0.06]" />
        <div className="glass-strong mt-8 h-14 rounded-[28px]" />
        <div className="mt-5 flex flex-wrap gap-2">
          {[180, 220, 160].map((w) => (
            <div key={w} className="h-10 animate-pulse rounded-full bg-fg-1/[0.06]" style={{ width: w }} />
          ))}
        </div>
      </div>
      <div className="glass hidden h-[300px] rounded-[24px] lg:block" />
    </div>
  );
}
