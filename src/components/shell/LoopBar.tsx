import { loadLoopData } from "./loop-data";
import { LoopBarView } from "./LoopBarView";

/** Server: reads the live loop counts (one per-request cached query) and renders the strip. Render inside Suspense. */
export async function LoopBar() {
  const d = await loadLoopData();
  return <LoopBarView counts={d.counts} running={d.running} next={d.next} />;
}

/** Same footprint while the counts load (no CLS); placeholders instead of numbers, never a guessed count. */
export function LoopBarFallback() {
  return (
    <div aria-busy="true" aria-label="Core loop, loading" role="status" className="flex h-10 items-center gap-3 border-b border-line bg-ink-0 px-3 sm:px-6 lg:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden">
        {["Triage", "Draft", "Approve", "File"].map((l) => (
          <span key={l} className="inline-flex shrink-0 items-center gap-2 px-2">
            <span className="instrument-label">{l}</span>
            <span aria-hidden className="h-3 w-4 animate-pulse rounded-sm bg-ink-3" />
          </span>
        ))}
      </div>
      <span aria-hidden className="h-7 w-40 shrink-0 animate-pulse rounded-full bg-ink-2" />
    </div>
  );
}
