"use client";

import { formatUSD } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { RibbonSegment } from "./view-model";

/**
 * The thin state ribbon above the table (§6.4): a stacked bar of the rows in view by owner state, which doubles as the
 * State filter. Amounts are sums of the listed rows; no estimate. The active state is solid blue, the rest step down.
 */
export function StateRibbon({ segments, active, onPick }: { segments: RibbonSegment[]; active: string | null; onPick: (state: string | null) => void }) {
  if (segments.length === 0) return null;
  return (
    <div className="mb-4" data-testid="state-ribbon">
      <div role="group" aria-label="Filter by owner state" className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
        {segments.map((s, i) => {
          const on = active !== null && s.state === active;
          return (
            <span
              key={s.state ?? "unknown"}
              aria-hidden
              className={cn(
                "h-full transition-opacity duration-150",
                s.state === null ? "border border-dashed border-fg-4" : on ? "bg-blue-400" : i === 0 ? "bg-blue-500" : i === 1 ? "bg-blue-300" : "bg-fg-3",
                active !== null && !on && "opacity-35",
              )}
              style={{ width: `${(s.share * 100).toFixed(3)}%` }}
            />
          );
        })}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-1 gap-y-1">
        {segments.map((s) => {
          const on = active !== null && s.state === active;
          const label = s.state ?? "Unknown";
          return (
            <li key={label}>
              <button
                type="button"
                aria-pressed={on}
                disabled={s.state === null}
                data-testid={`ribbon-${label}`}
                onClick={() => onPick(on ? null : s.state)}
                title={s.state === null ? "Owner state unknown: no state rules apply yet" : on ? `Show every state` : `Only ${label}`}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors duration-150 disabled:cursor-default",
                  on ? "bg-ink-3 text-fg-1" : "text-fg-2 hover:bg-ink-2 hover:text-fg-1",
                )}
              >
                <span className="font-mono font-medium text-fg-1">{label}</span>
                <span className="num">{formatUSD(s.cents)}</span>
                <span className="num text-fg-3">{s.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
