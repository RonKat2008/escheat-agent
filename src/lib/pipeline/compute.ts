/**
 * Shared timeline computation + persistence helpers for detect / recompute / advance.
 * All legal dates come from the rules engine (code); statuses come from the pure state machine.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach, type PropertyType, type StaleStatus } from "@/db/schema";
import type { IsoDate } from "@/lib/dates";
import { computeTimeline, type Timeline } from "@/lib/rules/engine";
import { tryLoadRules, type LoadedRules } from "@/lib/rules/load";
import { nextTransition, type MachineAction, type TransitionResult } from "@/lib/timeline/machine";

export const TERMINAL_STATUSES: ReadonlySet<StaleStatus> = new Set<StaleStatus>(["resolved_paid", "remitted"]);

export interface ItemDates {
  presumedAbandonedDate: string | null;
  ddWindowStart: string | null;
  ddWindowEnd: string | null;
  reportDueDate: string | null;
  remitDueDate: string | null;
  reportStage: string | null;
  ruleVersion: string | null;
  dependsOnUnverified: boolean;
}

export const EMPTY_DATES: ItemDates = {
  presumedAbandonedDate: null,
  ddWindowStart: null,
  ddWindowEnd: null,
  reportDueDate: null,
  remitDueDate: null,
  reportStage: null,
  ruleVersion: null,
  dependsOnUnverified: false,
};

export interface TimelineSummary {
  stages: Array<{ name: string; asOf: string | null; due: string | null; includesRemittance: boolean }>;
  ddApplies: boolean | null;
  anyUnknown: boolean;
  anyUnverified: boolean;
  warnings: string[];
  needsRuleReason: string | null;
}

export interface ComputedTimeline {
  dates: ItemDates;
  summary: TimelineSummary;
  ddApplies: boolean | null;
  /** NAUPA code from the rule file (never chosen by a model). */
  propertyCode: string | null;
}

export const DATE_KEYS = [
  "presumedAbandonedDate",
  "ddWindowStart",
  "ddWindowEnd",
  "reportDueDate",
  "remitDueDate",
] as const;

export function rulesFor(state: string | null): LoadedRules | null {
  return state ? tryLoadRules(state) : null;
}

/** NAUPA code for (state, property type) from the rule file, or null. */
export function naupaCodeFor(state: string, propertyType: PropertyType): string | null {
  const loaded = rulesFor(state);
  return loaded?.file.propertyTypes[propertyType]?.naupaCode.value ?? null;
}

function fromTimeline(tl: Timeline, propertyCode: string | null): ComputedTimeline {
  const first = tl.reportStages[0];
  return {
    ddApplies: tl.ddApplies,
    propertyCode,
    dates: {
      presumedAbandonedDate: tl.presumedAbandoned.date,
      ddWindowStart: tl.ddWindow.start.date,
      ddWindowEnd: tl.ddWindow.end.date,
      reportDueDate: first?.due.date ?? null,
      remitDueDate: tl.remitDue.date,
      reportStage: first?.name ?? null,
      ruleVersion: tl.rules.version,
      dependsOnUnverified: tl.anyUnverified,
    },
    summary: {
      stages: tl.reportStages.map((s) => ({
        name: s.name,
        asOf: s.asOf.date,
        due: s.due.date,
        includesRemittance: s.includesRemittance,
      })),
      ddApplies: tl.ddApplies,
      anyUnknown: tl.anyUnknown,
      anyUnverified: tl.anyUnverified,
      warnings: tl.warnings,
      needsRuleReason: null,
    },
  };
}

export interface TimelineArgs {
  ownerState: string | null;
  propertyType: PropertyType;
  lastActivityDate: IsoDate;
  amountCents: number;
  /** companies.fiscal_year_end (MM-DD). */
  holderFiscalYearEnd: string;
}

/**
 * Compute dates for one item with the CURRENT rule file for its owner state. States without a rule file
 * (everything but CA/DE/TX) yield empty dates plus a needsRuleReason: never a guess.
 */
export function computeItemTimeline(args: TimelineArgs): ComputedTimeline {
  const rules = rulesFor(args.ownerState);
  if (!args.ownerState || !rules) {
    const reason = args.ownerState
      ? `No rule file for ${args.ownerState}: state is out of scope for this prototype (only CA, DE, TX are supported).`
      : "Owner state could not be determined.";
    return {
      dates: EMPTY_DATES,
      ddApplies: null,
      propertyCode: null,
      summary: {
        stages: [],
        ddApplies: null,
        anyUnknown: true,
        anyUnverified: false,
        warnings: [reason],
        needsRuleReason: reason,
      },
    };
  }
  const tl = computeTimeline(
    {
      propertyType: args.propertyType,
      lastActivityDate: args.lastActivityDate,
      amountCents: args.amountCents,
      ownerState: args.ownerState,
      holderFiscalYearEnd: args.holderFiscalYearEnd,
    },
    rules.file,
  );
  return fromTimeline(tl, naupaCodeFor(args.ownerState, args.propertyType));
}

export interface StatusInput extends ItemDates {
  status: StaleStatus;
}

/** Run the pure machine on persisted dates. Items with unknown deadlines stay/become needs_rule. */
export function decideStatus(item: StatusInput, ddApplies: boolean | null, today: IsoDate): TransitionResult {
  const r = nextTransition(
    {
      status: item.status,
      ddWindowStart: item.ddWindowStart as IsoDate | null,
      ddWindowEnd: item.ddWindowEnd as IsoDate | null,
      reportDueDate: item.reportDueDate as IsoDate | null,
      remitDueDate: item.remitDueDate as IsoDate | null,
      ddApplies,
    },
    today,
  );
  const stuck = r.actions.some((a) => a.type === "needs_rule");
  if (stuck && r.status === "watching") return { ...r, status: "needs_rule", changed: item.status !== "needs_rule" };
  return r;
}

/** Previously-set deadlines that now differ (a newly computed date from null is not a "move"). */
export function deadlinesMoved(prev: Partial<ItemDates>, next: ItemDates): boolean {
  return DATE_KEYS.some((k) => prev[k] != null && prev[k] !== next[k]);
}

/** Perform DB side effects for machine actions. Only creates DRAFTS; never sends anything. */
export async function applyActions(
  db: Db,
  item: { id: string; companyId: string },
  actions: readonly MachineAction[],
): Promise<{ outreachCreated: boolean }> {
  let outreachCreated = false;
  if (actions.some((a) => a.type === "create_outreach_task")) {
    const existing = await db
      .select({ id: outreach.id })
      .from(outreach)
      .where(and(eq(outreach.staleItemId, item.id), eq(outreach.channel, "letter")))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(outreach).values({
        companyId: item.companyId,
        staleItemId: item.id,
        channel: "letter",
        status: "draft",
      });
      outreachCreated = true;
    }
  }
  return { outreachCreated };
}

