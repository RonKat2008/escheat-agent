/**
 * Projected audit interest (pure). The rate, basis, day count and sources come only from each state's sourced interest
 * rule through the rules engine (computeAuditInterest, e.g. CA CCP § 1577 at 12% simple). A missing rule, an
 * unsupported basis, or a missing due date is UNKNOWN, never a guess. At offset 0 with no scenario this equals
 * getAuditInterestExposure (src/lib/queries/interest.ts), which it mirrors item for item.
 *
 * Interest runs from the accrual start to the simulated date. Under on-time handling it stops when the obligation that
 * started it is performed (a catch-up filing today stops it today; an on-time filing never starts it). That stop is a
 * scenario assumption, not a rule value, and the UI says so.
 */
import { accrualStart } from "@/lib/interest/accrual-start";
import { compare, maxDate, type IsoDate } from "@/lib/dates";
import { computeAuditInterest, type InterestItem } from "@/lib/rules/engine";
import { handlingOf, stateOf } from "./scenario";
import { UNKNOWN_STATE, type InterestRules, type Projection, type Scenario, type StateInterest, type WhatIfItem, type WhatIfSnapshot } from "./types";

type Accrual = { kind: "line"; start: IsoDate | null; end: IsoDate } | { kind: "skip" } | { kind: "unknown"; note: string };

const minDate = (a: IsoDate, b: IsoDate): IsoDate => (compare(a, b) <= 0 ? a : b);

/** Accrual window for one item, mirroring getAuditInterestExposure for the start date. */
export function accrualFor(item: WhatIfItem, rules: InterestRules, onTime: boolean, today: IsoDate, at: IsoDate): Accrual {
  if (item.status === "reported") {
    // Reported, not remitted: accrues from the remit due date only when the sourced rule says late payment starts it.
    const start = accrualStart({ reportDue: null, remitDue: (item.remitDueDate ?? undefined) as IsoDate | undefined }, rules);
    const cure = onTime && item.remitDueDate ? maxDate(item.remitDueDate as IsoDate, today) : null;
    const end = cure ? minDate(at, cure) : at;
    if (start === "unsupported") {
      return item.remitDueDate && compare(item.remitDueDate as IsoDate, end) < 0
        ? { kind: "unknown", note: `${rules.state} interest rule does not say a late payment starts interest; not estimated for reported items` }
        : { kind: "skip" };
    }
    return { kind: "line", start, end };
  }
  const start = (item.reportDueDate ?? null) as IsoDate | null;
  const cure = onTime && start ? maxDate(start, today) : null;
  return { kind: "line", start, end: cure ? minDate(at, cure) : at };
}

function unknownState(state: string, note: string, rules: InterestRules | null): StateInterest {
  return {
    state,
    status: "unknown",
    cents: null,
    verified: false,
    ruleVersion: rules?.version ?? null,
    annualRatePct: rules?.interest.value?.annualRatePct ?? null,
    sources: (rules?.interest.sources ?? []).map((s) => ({ url: s.url, title: s.title, quote: s.quote })),
    notes: [note],
  };
}

function stateInterest(state: string, items: WhatIfItem[], rules: InterestRules | null, s: Scenario, today: IsoDate, at: IsoDate): StateInterest {
  if (state === UNKNOWN_STATE) return unknownState(state, "Owner state unknown; interest cannot be estimated", null);
  if (!rules) return unknownState(state, `No rule file for ${state}; interest is UNKNOWN`, null);
  const accruals = items.map((i) => ({ i, a: accrualFor(i, rules, handlingOf(i, s) === "on_time", today, at) }));
  const blocked = accruals.find((x) => x.a.kind === "unknown");
  if (blocked && blocked.a.kind === "unknown") return unknownState(state, blocked.a.note, rules);

  // computeAuditInterest takes one asOf, so group the lines by their end date and sum.
  const groups = new Map<IsoDate, InterestItem[]>();
  for (const { i, a } of accruals) {
    if (a.kind !== "line") continue;
    groups.set(a.end, [...(groups.get(a.end) ?? []), { id: i.id, amountCents: i.amountCents, reportDueDate: a.start ?? undefined }]);
  }
  const results = [...groups.entries()].map(([end, lines]) => computeAuditInterest(lines, rules, end));
  const anyUnknown = results.some((r) => r.status === "unknown");
  const first = results[0];
  const notes = [...new Set(results.flatMap((r) => r.notes))];
  if (anyUnknown) return { ...unknownState(state, notes.find((n) => !n.startsWith("Simple")) ?? "Interest is UNKNOWN", rules), notes };
  return {
    state,
    status: "ok",
    cents: results.reduce((a, r) => a + (r.totalCents ?? 0), 0),
    // An empty group list (nothing accrues) still rests on the rule's own verified flag.
    verified: first ? results.every((r) => r.verified) : rules.interest.verified,
    ruleVersion: rules.version,
    annualRatePct: rules.interest.value?.annualRatePct ?? null,
    sources: (first?.sources ?? rules.interest.sources).map((x) => ({ url: x.url, title: x.title, quote: x.quote })),
    notes,
  };
}

export function projectInterest(snap: WhatIfSnapshot, s: Scenario, at: IsoDate): Projection["interest"] {
  const today = snap.today as IsoDate;
  const groups = new Map<string, WhatIfItem[]>();
  for (const item of snap.items) {
    if (handlingOf(item, s) === "paid") continue;
    const k = stateOf(item);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  const byState = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([state, items]) => stateInterest(state, items, snap.rules[state] ?? null, s, today, at));
  const unknownStates = byState.filter((x) => x.status === "unknown").map((x) => x.state);
  const knownCents = byState.reduce((a, x) => a + (x.cents ?? 0), 0);
  return {
    cents: unknownStates.length > 0 ? null : knownCents,
    knownCents,
    unknownStates,
    anyUnverified: byState.some((x) => !x.verified),
    byState,
  };
}
