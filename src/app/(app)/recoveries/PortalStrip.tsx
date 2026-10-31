import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface PortalStat {
  state: string;
  matches: number;
  /** ISO timestamp of the latest recovery search that covered this portal, or null when never searched. */
  lastSearched: string | null;
}

const CELL = ["pr-2 sm:pr-4", "border-l border-line pr-2 pl-4 sm:pr-4 sm:pl-6", "border-l border-line pr-0 pl-4 sm:pl-6"];

/** Hairline-separated portal status: one cell per replica state portal. */
export function PortalStrip({ portals }: { portals: PortalStat[] }) {
  return (
    <dl className="grid grid-cols-3 border-y border-line" aria-label="Replica portals">
      {portals.map((p, i) => (
        <div key={p.state} className={cn("min-w-0 py-4", CELL[i])}>
          <dt className="mb-1.5 text-[13px] text-fg-2">{p.state} portal</dt>
          <dd className={cn("num text-sm leading-6 whitespace-nowrap sm:text-base font-medium", p.matches > 0 ? "text-fg-1" : "text-fg-3")}>
            {p.matches > 0 ? `${p.matches} ${p.matches === 1 ? "match" : "matches"}` : "0 matches"}
          </dd>
          <dd className="num mt-0.5 text-[13px] text-fg-3">{p.lastSearched ? `Searched ${formatDate(p.lastSearched.slice(0, 10))}` : "Not searched"}</dd>
        </div>
      ))}
    </dl>
  );
}
