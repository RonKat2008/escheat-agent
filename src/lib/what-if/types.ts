/**
 * What-if simulator types. A snapshot is a READ of persisted rules-engine output (stale_items dates) plus the sourced
 * interest rule per state. Scenarios never touch the demo clock, sim_clock or any table: they are pure inputs.
 */
import type { ItemStatus, ObligationKind } from "@/lib/overdue";
import type { RuleFile } from "../../../rules/schema";

/** The slice of a rule file the interest projection needs (serializable, so the client can re-run the math). */
export type InterestRules = Pick<RuleFile, "state" | "version" | "interest">;

export interface WhatIfItem {
  id: string;
  payeeName: string;
  checkNumber: string | null;
  amountCents: number;
  /** Owner state; null = unknown (grouped as "UNKNOWN", never inferred). */
  ownerState: string | null;
  status: ItemStatus;
  presumedAbandonedDate: string | null;
  ddWindowStart: string | null;
  ddWindowEnd: string | null;
  reportDueDate: string | null;
  remitDueDate: string | null;
  reportStage: string | null;
  /** Some rule value behind these dates is unverified (UNVERIFIED badge stays). */
  unverified: boolean;
}

export interface WhatIfSnapshot {
  /** Demo-clock today (read, never written). */
  today: string;
  items: WhatIfItem[];
  /** Interest rule per owner state; null when the state has no rule file (interest is UNKNOWN). */
  rules: Record<string, InterestRules | null>;
}

/** Per-item scenario. "none" = no response (the default, so it is never stored). */
export type ItemScenario = "none" | "paid" | "next_report";
export const ITEM_SCENARIOS: readonly ItemScenario[] = ["none", "paid", "next_report"] as const;

export interface Scenario {
  /** Days forward from the demo clock's today, 0..MAX_OFFSET. */
  offset: number;
  /** Items whose owner responds and is paid. */
  paid: readonly string[];
  /** Items remitted with the next report (filed and remitted on their own due dates). */
  nextReport: readonly string[];
  /** States filed and remitted on their due dates; every other state misses them. */
  onTimeStates: readonly string[];
}

export const MAX_OFFSET = 730;
export const UNKNOWN_STATE = "UNKNOWN";

/** How an item is handled in a scenario. */
export type Handling = "paid" | "on_time" | "miss";

export type EventKind = "presumed_abandoned" | "dd_window_start" | ObligationKind;

/** One dated crossing for one item, as the timeline draws it. */
export interface TimelineEvent {
  key: string;
  itemId: string;
  kind: EventKind;
  date: string;
  state: string;
  amountCents: number;
  unverified: boolean;
  /** For obligations: was it performed by its date under the scenario? Crossings (presumed, DD opens) are "crossing". */
  outcome: "met" | "missed" | "moot" | "crossing";
}

export interface StateExposure {
  state: string;
  cents: number;
  count: number;
  anyUnverified: boolean;
}

export interface StateInterest {
  state: string;
  status: "ok" | "unknown" | "none";
  cents: number | null;
  verified: boolean;
  ruleVersion: string | null;
  annualRatePct: number | null;
  sources: { url: string; title: string; quote: string }[];
  notes: string[];
}

export interface Projection {
  asOf: string;
  offset: number;
  exposure: { cents: number; count: number; byState: StateExposure[] };
  interest: {
    /** Null = UNKNOWN (some state's rule is missing or unsupported); see knownCents for the labelled subtotal. */
    cents: number | null;
    knownCents: number;
    unknownStates: string[];
    anyUnverified: boolean;
    byState: StateInterest[];
  };
  deadlines: {
    /** Missed obligations still owed at asOf (src/lib/overdue.ts semantics). */
    missed: number;
    missedItems: number;
    /** Owed obligations whose date is unknown (never counted as missed). */
    unknown: number;
    anyUnverified: boolean;
  };
  /** Crossings strictly after today and on or before asOf. */
  crossings: Record<EventKind, number>;
}
