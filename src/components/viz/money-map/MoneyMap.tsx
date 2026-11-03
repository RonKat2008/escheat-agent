/**
 * Server half of the Money Map. Renders the floor (the US outline, interior borders and the states that hold money)
 * as SVG on the server, so the 100 KB of geography never ships as client JS, and hands the client stage only the
 * figures it draws. Every figure comes from getMoneyFlow / loadOpenRows; nothing is invented.
 */
import type { ReactNode } from "react";
import { SrTable, VIZ } from "@/components/viz/core";
import { MoneyMapStage } from "./MoneyMapStage";
import type { MapHq, MapRecovered, MapStateDatum } from "./types";
import { US_BORDERS_PATH, US_NATION_PATH, US_STATES, US_VIEWBOX } from "./us-paths";

export interface MoneyMapInput {
  states: Omit<MapStateDatum, "name" | "cx" | "cy">[];
  /** State of incorporation (the HQ the threads leave from). */
  hqState: string | null;
  recovered: { state: string; formatted: string; count: number }[];
  legend: ReactNode;
  title?: string;
}

/** States outside the map (owner state unknown) are listed in the legend, never placed on a guessed location. */
export function placeableStates<T extends { state: string }>(states: T[]): { placed: T[]; unplaced: T[] } {
  return { placed: states.filter((s) => US_STATES[s.state]), unplaced: states.filter((s) => !US_STATES[s.state]) };
}

export function MoneyMap({ states, hqState, recovered, legend, title = "Money map" }: MoneyMapInput) {
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
  const held = new Set(data.map((d) => d.state));

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
    <figure className="m-0 min-w-0" aria-label={title}>
      <MoneyMapStage states={data} hq={hq} recovered={rec} viewBox={US_VIEWBOX} floor={floor} legend={legend} />
      <SrTable
        caption={`${title}: exposure by owner state${hq ? `, threads from HQ in ${hq.name}` : ""}`}
        columns={["State", "Amount", "Items", "Due within 7 days or overdue", "Verification"]}
        rows={states.map((s) => [s.state, s.formatted, String(s.count), String(s.urgent), s.unverified ? "Some dates unverified" : "Verified"])}
      />
    </figure>
  );
}
