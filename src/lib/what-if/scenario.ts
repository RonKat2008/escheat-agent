/** Scenario normalization and per-item handling (pure). */
import { MAX_OFFSET, UNKNOWN_STATE, type Handling, type Scenario, type WhatIfItem, type WhatIfSnapshot } from "./types";

export const EMPTY_SCENARIO: Scenario = { offset: 0, paid: [], nextReport: [], onTimeStates: [] };

export const stateOf = (i: Pick<WhatIfItem, "ownerState">): string => i.ownerState ?? UNKNOWN_STATE;

/** Clamp the offset, drop ids and states the snapshot does not know, de-duplicate, and let "paid" win over "next report". */
export function normalizeScenario(s: Partial<Scenario>, snap: Pick<WhatIfSnapshot, "items">): Scenario {
  const ids = new Set(snap.items.map((i) => i.id));
  const states = new Set(snap.items.map(stateOf));
  const raw = Number(s.offset ?? 0);
  const offset = Number.isFinite(raw) ? Math.min(MAX_OFFSET, Math.max(0, Math.round(raw))) : 0;
  const uniq = (xs: readonly string[] | undefined, keep: (x: string) => boolean) => [...new Set((xs ?? []).filter(keep))].sort();
  const paid = uniq(s.paid, (x) => ids.has(x));
  const paidSet = new Set(paid);
  return {
    offset,
    paid,
    nextReport: uniq(s.nextReport, (x) => ids.has(x) && !paidSet.has(x)),
    onTimeStates: uniq(
      (s.onTimeStates ?? []).map((x) => x.toUpperCase()),
      (x) => states.has(x) && x !== UNKNOWN_STATE,
    ),
  };
}

export function handlingOf(item: WhatIfItem, s: Scenario): Handling {
  if (s.paid.includes(item.id)) return "paid";
  if (s.nextReport.includes(item.id) || s.onTimeStates.includes(stateOf(item))) return "on_time";
  return "miss";
}
