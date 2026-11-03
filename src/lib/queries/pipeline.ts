/**
 * Approvals pipeline (DESIGN-V3 §4.3): counts and cents per status for the three lanes that pass through a human gate,
 * Outreach, Reports and Recoveries. Every number is a COUNT/SUM over real rows; nothing is estimated.
 *
 * The gate ("YOU") counts exactly what waits on a person, using the same status sets as the sidebar badge and the
 * Approvals list header (countWaiting in approvals/queue-count.ts), so the three always agree.
 */
import { and, count, eq, inArray, isNull, sql, sum } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach, recoveries, reports, ruleChanges, staleItems } from "@/db/schema";
import { ACTIONABLE_OUTREACH, ACTIONABLE_RECOVERY, ACTIONABLE_REPORT } from "@/app/(app)/approvals/queue-count";

export type PipelineLaneId = "outreach" | "reports" | "recoveries";

export interface PipelineStage {
  /** The status this node stands for. */
  status: string;
  label: string;
  count: number;
  cents: number;
  /** The awaiting_approval node of the lane: it sits in the shared gate column. */
  gate: boolean;
}

export interface PipelineLane {
  id: PipelineLaneId;
  label: string;
  /** Main path, left to right; index GATE_COLUMN is the gate node. Stages before the lane's first slot are null. */
  stages: (PipelineStage | null)[];
  /** Off-ramp statuses (failed / cancelled / rejected), drawn below the lane. */
  offRamp: PipelineStage[];
  /** Items of this lane that wait on a person now (the lane's share of the gate). */
  waiting: number;
  waitingCents: number;
}

export interface Pipeline {
  lanes: PipelineLane[];
  /** Proposed rule changes: they wait on a person too but have no lane. */
  ruleChanges: number;
  /** Everything that waits on a person: equals countWaiting(). */
  gateTotal: number;
}

/** Column of the shared "YOU" gate in every lane. */
export const GATE_COLUMN = 2;
export const PIPELINE_COLUMNS = 7;

interface LaneSpec {
  id: PipelineLaneId;
  label: string;
  /** Slot per column (length PIPELINE_COLUMNS); null = empty slot. */
  path: (readonly [status: string, label: string] | null)[];
  offRamp: (readonly [status: string, label: string])[];
}

export const LANE_SPECS: readonly LaneSpec[] = [
  {
    id: "outreach",
    label: "Outreach",
    path: [null, ["draft", "Draft"], ["awaiting_approval", "Awaiting you"], ["approved", "Approved"], ["sent", "Sent"], ["delivered", "Delivered"], ["responded", "Owner replied"]],
    offRamp: [
      ["failed", "Failed"],
      ["cancelled", "Cancelled"],
    ],
  },
  {
    id: "reports",
    label: "Reports",
    path: [["draft", "Draft"], ["validated", "Validated"], ["awaiting_approval", "Awaiting you"], ["approved", "Approved"], ["submitted", "Submitted"], ["confirmed", "Confirmed"], null],
    offRamp: [["failed", "Failed"]],
  },
  {
    id: "recoveries",
    label: "Recoveries",
    path: [["found", "Found"], ["claim_drafted", "Claim drafted"], ["awaiting_approval", "Awaiting you"], ["claim_submitted", "Claim filed"], ["paid", "Paid"], null, null],
    offRamp: [["rejected", "Rejected"]],
  },
];

type Tally = Map<string, { count: number; cents: number }>;

const num = (v: unknown) => Number(v ?? 0);

function tallyOf(rows: { status: string; n: unknown; cents: unknown }[]): Tally {
  return new Map(rows.map((r) => [r.status, { count: num(r.n), cents: num(r.cents) }]));
}

function buildLane(spec: LaneSpec, tally: Tally, waiting: { count: number; cents: number }): PipelineLane {
  const stage = ([status, label]: readonly [string, string], gate: boolean): PipelineStage => ({
    status,
    label,
    count: tally.get(status)?.count ?? 0,
    cents: tally.get(status)?.cents ?? 0,
    gate,
  });
  return {
    id: spec.id,
    label: spec.label,
    stages: spec.path.map((p, i) => (p ? stage(p, i === GATE_COLUMN) : null)),
    offRamp: spec.offRamp.map((p) => stage(p, false)),
    waiting: waiting.count,
    waitingCents: waiting.cents,
  };
}

export async function getPipeline(db: Db, companyId: string): Promise<Pipeline> {
  const [outRows, repRows, recRows, outWait, repWait, recWait, ruleRows] = await Promise.all([
    db
      .select({ status: outreach.status, n: count(), cents: sum(staleItems.amountCents) })
      .from(outreach)
      .innerJoin(staleItems, eq(staleItems.id, outreach.staleItemId))
      .where(eq(outreach.companyId, companyId))
      .groupBy(outreach.status),
    db
      .select({ status: reports.status, n: count(), cents: sum(reports.totalCents) })
      .from(reports)
      .where(eq(reports.companyId, companyId))
      .groupBy(reports.status),
    db
      .select({ status: recoveries.status, n: count(), cents: sum(recoveries.amountCents) })
      .from(recoveries)
      .where(eq(recoveries.companyId, companyId))
      .groupBy(recoveries.status),
    db
      .select({ n: count(), cents: sum(staleItems.amountCents) })
      .from(outreach)
      .innerJoin(staleItems, eq(staleItems.id, outreach.staleItemId))
      .where(and(eq(outreach.companyId, companyId), inArray(outreach.status, [...ACTIONABLE_OUTREACH]))),
    db
      .select({ n: count(), cents: sum(reports.totalCents) })
      .from(reports)
      .where(and(eq(reports.companyId, companyId), inArray(reports.status, [...ACTIONABLE_REPORT]))),
    db
      .select({ n: count(), cents: sum(recoveries.amountCents) })
      .from(recoveries)
      .where(and(eq(recoveries.companyId, companyId), inArray(recoveries.status, [...ACTIONABLE_RECOVERY]), isNull(recoveries.approvalId))),
    db.select({ n: sql<number>`count(*)` }).from(ruleChanges).where(eq(ruleChanges.status, "proposed")),
  ]);

  const w = (rows: { n: unknown; cents: unknown }[]) => ({ count: num(rows[0]?.n), cents: num(rows[0]?.cents) });
  const waiting = { outreach: w(outWait), reports: w(repWait), recoveries: w(recWait) };
  const tallies: Record<PipelineLaneId, Tally> = { outreach: tallyOf(outRows), reports: tallyOf(repRows), recoveries: tallyOf(recRows) };
  const lanes = LANE_SPECS.map((s) => buildLane(s, tallies[s.id], waiting[s.id]));
  const rules = num(ruleRows[0]?.n);
  return {
    lanes,
    ruleChanges: rules,
    gateTotal: lanes.reduce((a, l) => a + l.waiting, 0) + rules,
  };
}
