/**
 * Server half of the Money Map. Renders the floor (the US outline, interior borders and the states that hold money)
 * as SVG on the server, so the 100 KB of geography never ships as client JS, and hands the client stage only the
 * figures it draws. Every figure comes from getMoneyFlow / loadOpenRows; nothing is invented.
 */
import type { ReactNode } from "react";
import { SrTable, VIZ } from "@/components/viz/core";
import { NotCoveredGroup } from "./NotCoveredGroup";
import { MoneyMapStage } from "./MoneyMapStage";
import type { MapHq, MapRecovered, MapStateDatum } from "./types";
import { US_BORDERS_PATH, US_NATION_PATH, US_STATES, US_VIEWBOX } from "./us-paths";

export interface MoneyMapInput {
  states: Omit<MapStateDatum, "name" | "cx" | "cy">[];
  /** State of incorporation (the HQ the threads leave from). */
  hqState: string | null;
  recovered: { state: string; formatted: string; count: number }[];
  /** Readout shown when no column is active. Omitted in the compact preview, which has no readout row. */
  legend?: ReactNode;
  title?: string;
  /**
   * Ask's "Where the money is" preview (docs/ASK-MODE.md §4): about 360x220, shorter columns, short labels, no legend or
   * readout row. Same data, same SrTable, same static tier under reduced motion.
   */
  compact?: boolean;
}

/** States outside the map (owner state unknown) are listed in the legend, never placed on a guessed location. */
export function placeableStates<T extends { state: string }>(states: T[]): { placed: T[]; unplaced: T[] } {
  return { placed: states.filter((s) => US_STATES[s.state]), unplaced: states.filter((s) => !US_STATES[s.state]) };
}

export function MoneyMap({ states, hqState, recovered, legend = null, title = "Money map", compact = false }: MoneyMapInput) {
  const { placed } = placeableStates(states);
  const data: MapStateDatum[] = placed.map((s) => {
    const g = US_STATES[s.state]!;
    return { ...s, name: g.name, cx: g.cx, cy: g.cy };
  });
  const hqGeo = hqState ? US_STATES[hqState] : undefined;
  const hq: MapHq | null = hqGeo ? { state: hqGeo.code, name: hqGeo.name, cx: hqGeo.cx, cy: hqGeo.cy } : null;
  const rec: MapRecovered[] = recovered.flatMap((r) => {
    const g = US_STATES[r.state];
    return g ? [{ state: r.state, cx: g.cx, cy: g.cy, formatted: r.formatted, count: r.count }] : [];
  });
  // R10-02: uncovered states are one dashed group, not columns.
  const columnsData = data.filter((d) => !d.notCovered);
  const uncovered = data.filter((d) => d.notCovered);
  const held = new Set(columnsData.map((d) => d.state));

  const floor = (
    <svg aria-hidden viewBox={`0 0 ${US_VIEWBOX.width} ${US_VIEWBOX.height}`} className="absolute inset-0 block h-full w-full overflow-visible">
      <path d={US_NATION_PATH} fill={VIZ.ink1} stroke={VIZ.lineStrong} strokeWidth={1.25} />
      <path d={US_BORDERS_PATH} fill="none" stroke={VIZ.line} strokeWidth={0.75} />
      {Object.values(US_STATES)
        .filter((s) => held.has(s.code))
        .map((s) => (
          <path key={s.code} d={s.d} fill={VIZ.blue950} stroke={VIZ.blue700} strokeWidth={1.25} />
        ))}
      {hqGeo && !held.has(hqGeo.code) ? <path d={hqGeo.d} fill="none" stroke={VIZ.blue400} strokeWidth={1} strokeDasharray="3 3" /> : null}
    </svg>
  );

  return (
    <figure className="relative m-0 min-w-0 overflow-x-clip" aria-label={title}>
      <MoneyMapStage states={columnsData} hq={hq} recovered={rec} viewBox={US_VIEWBOX} floor={floor} legend={legend} compact={compact} />
      <NotCoveredGroup states={uncovered} compact={compact} />
      <SrTable
        caption={`${title}: exposure by owner state${hq ? `, threads from HQ in ${hq.name}` : ""}`}
        columns={["State", "Amount", "Items", "Overdue", "Due within 7 days", "Verification"]}
        rows={states.map((s) => [s.state, s.formatted, String(s.count), String(s.late), String(s.urgent), s.notCovered ? "Rules not loaded, no dates" : s.unverified ? "Some dates unverified" : "Verified"])}
      />
    </figure>
  );
}
