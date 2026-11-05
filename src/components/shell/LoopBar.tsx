import { loadLoopData } from "./loop-data";
import { LoopBarView } from "./LoopBarView";
import { HideOnHeroPage } from "./loop-slot";

/** Server: reads the live loop counts (one per-request cached query) and renders the strip. Render inside Suspense. */
export async function LoopBar({ placement = "shell" }: { placement?: "shell" | "page" }) {
  const d = await loadLoopData();
  return <LoopBarView counts={d.counts} running={d.running} next={d.next} placement={placement} />;
}

/** Same footprint while the counts load (no CLS); placeholders instead of numbers, never a guessed count. */
export function LoopBarFallback() {
  return (
    <HideOnHeroPage>
    <div aria-busy="true" aria-label="Core loop, loading" role="status" className="glass mx-3 mt-3 flex h-11 items-center gap-3 rounded-full pr-1.5 pl-3 sm:mx-6 lg:mx-8 lg:mt-4">
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
    </HideOnHeroPage>
  );
}
