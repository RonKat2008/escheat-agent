import Link from "next/link";
import { formatUSD } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { MapStateDatum } from "./types";

/**
 * R10-02: states with money owed but no rules file are not given a column on the map (four crowded labels overlapped
 * and, at phone width, lost their marker). They are one dashed group beside the map with a count and a total, one link
 * per state. Dashed = not something the app files in yet; no dates are shown for them.
 */
export function NotCoveredGroup({ states, compact = false }: { states: MapStateDatum[]; compact?: boolean }) {
  if (states.length === 0) return null;
  const cents = states.reduce((a, s) => a + s.cents, 0);
  const items = states.reduce((a, s) => a + s.count, 0);
  return (
    <section
      aria-label="Not covered yet"
      data-testid="map-not-covered"
      className={cn("mt-3 rounded-[10px] border border-dashed border-fg-3 px-3 py-2.5", compact && "py-2")}
    >
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] text-fg-1">
        <span className="font-medium">Not covered yet</span>
        <span className="num text-fg-2" data-testid="map-not-covered-total">
          {states.length} {states.length === 1 ? "state" : "states"} · {items} {items === 1 ? "item" : "items"} · {formatUSD(cents)}
        </span>
        <span data-testid="not-covered-chip" className="rounded-[2px] border border-dashed border-fg-3 px-1 font-mono text-[9px] tracking-[0.06em] text-fg-2 uppercase">
          No rules loaded
        </span>
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {states.map((s) => (
          <li key={s.state}>
            <Link
              href={s.href}
              data-testid={`state-tile-${s.state}`}
              className="block rounded-[6px] border border-dashed border-line-strong bg-ink-1/90 px-2 py-1 text-left whitespace-nowrap hover:border-blue-400 focus-visible:outline-2 focus-visible:outline-blue-400"
            >
              <span className="flex items-baseline gap-1.5">
                <span className="font-mono text-[11px] font-medium tracking-[0.08em] text-fg-1">{s.state}</span>
                <span className="num text-[13px] font-medium text-fg-1">{s.short}</span>
                <span className="num text-[11px] text-fg-2">
                  {s.count} {s.count === 1 ? "item" : "items"}
                </span>
              </span>
              <span className="sr-only">{`, ${s.name}: ${s.formatted} across ${s.count} ${s.count === 1 ? "item" : "items"}, rules not loaded for this state so no dates are shown`}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
