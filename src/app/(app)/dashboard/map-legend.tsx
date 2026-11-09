import { placeableStates } from "@/components/viz/money-map/MoneyMap";
import { formatUSD } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { DashboardData } from "./data";

/** Legend under the map: how to read it, plus anything the map cannot place (never put on a guessed location). */
export function MapLegend({ d }: { d: DashboardData }) {
  const { unplaced } = placeableStates(d.mapStates);
  const total = Math.max(1, d.flow.exposure.cents);
  const hq = d.company.incorporationState;
  return (
    <div className="flex flex-col gap-2">
      <div aria-hidden data-testid="state-bar" className="flex h-1.5 gap-[2px] overflow-hidden rounded-full">
        {d.mapStates.map((s, i) => (
          <span key={s.state} className={cn("h-full", i === 0 ? "bg-blue-500" : i === 1 ? "bg-blue-300" : "bg-fg-3")} style={{ width: `${(s.cents / total) * 100}%` }} />
        ))}
      </div>
      <p className="text-xs text-fg-2">
        Column height is the amount at risk in each owner state. Threads run from HQ ({hq}, state of incorporation). A pink ring means something there is overdue or
        due within 7 days. Hover or focus a column for its largest items.
      </p>
      {unplaced.map((s) => (
        <p key={s.state} className="flex items-center gap-1.5 text-xs text-fg-2">
          <span aria-hidden className="size-2 rounded-full border border-dashed border-fg-3" />
          Owner state unknown: <span className="num text-fg-1">{s.formatted}</span> across <span className="num">{s.count}</span> items, not placed on the map.
        </p>
      ))}
      {d.flow.recovered ? (
        <p className="flex items-center gap-1.5 text-xs text-fg-2">
          <span aria-hidden className="h-px w-4 border-t border-dashed border-blue-300" />
          Recovered to you from state portals: <span className="num text-blue-300">{formatUSD(d.flow.recovered.cents)}</span>
        </p>
      ) : null}
    </div>
  );
}

