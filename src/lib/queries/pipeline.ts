/**
 * Approvals pipeline (DESIGN-V3 §4.3): counts and cents per status for the three lanes that pass through a human gate,
 * Outreach, Reports and Recoveries. Every number is a COUNT/SUM over real rows; nothing is estimated.
 *
 * The gate ("YOU") counts exactly what waits on a person: every gate node is its lane's share of waitingBreakdown
 * (approvals/queue-count.ts), the same derivation behind the sidebar badge and the Approvals list header, so the pink
 * column, the header and the badge always agree (R4-04). Other nodes are plain status tallies, except Outreach "To
 * compose" (drafts not written yet) and "Owner replied" (only replies through a link that was approved and sent, R4-10).
 */
import { and, count, eq, isNotNull, isNull, ne, or, sql, sum } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach, recoveries, reports, staleItems } from "@/db/schema";
import { waitingBreakdown } from "@/app/(app)/approvals/queue-count";

export type PipelineLaneId = "outreach" | "reports" | "recoveries";

export interface PipelineStage {
  /** The status this node stands for. */
  status: string;
  label: string;
  count: number;
  cents: number;
  /** The lane's gate node: it sits in the shared "YOU" column and counts everything of the lane that waits on a person. */
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
  /** Owner replies the holder still has to act on (reissue / verify / re-address): they wait on a person too. */
  ownerTasks: number;
  ownerTasksCents: number;
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
    path: [null, ["draft", "To compose"], ["awaiting_approval", "Awaiting you"], ["approved", "Approved"], ["sent", "Sent"], ["delivered", "Delivered"], ["responded", "Owner replied"]],
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
    // R4-04: the gate node is the lane's share of what waits on you (not just rows whose status is awaiting_approval).
    count: gate ? waiting.count : (tally.get(status)?.count ?? 0),
    cents: gate ? waiting.cents : (tally.get(status)?.cents ?? 0),
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

/** An outreach row that counts on the "Owner replied" node: answered through a link that was live (approved and sent). */
const realReply = and(eq(outreach.status, "responded"), isNotNull(outreach.approvalId));

export async function getPipeline(db: Db, companyId: string): Promise<Pipeline> {
  const [outRows, repRows, recRows, toCompose, replied, waiting] = await Promise.all([
    db
      .select({ status: outreach.status, n: count(), cents: sum(staleItems.amountCents) })
      .from(outreach)
      .innerJoin(staleItems, eq(staleItems.id, outreach.staleItemId))
      .where(and(eq(outreach.companyId, companyId), ne(outreach.status, "responded")))
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
    // "To compose": drafts the agent queued but has not written yet (the rest of the drafts are composed and wait on you).
    db
      .select({ n: count(), cents: sum(staleItems.amountCents) })
      .from(outreach)
      .innerJoin(staleItems, eq(staleItems.id, outreach.staleItemId))
      .where(and(eq(outreach.companyId, companyId), eq(outreach.status, "draft"), or(isNull(outreach.body), eq(sql`trim(${outreach.body})`, "")))),
    db
      .select({ n: count(), cents: sum(staleItems.amountCents) })
      .from(outreach)
      .innerJoin(staleItems, eq(staleItems.id, outreach.staleItemId))
      .where(and(eq(outreach.companyId, companyId), realReply)),
    waitingBreakdown(db, companyId),
  ]);

  const w = (rows: { n: unknown; cents: unknown }[]) => ({ count: num(rows[0]?.n), cents: num(rows[0]?.cents) });
  const outTally: Tally = new Map([...tallyOf(outRows), ["draft", w(toCompose)], ["responded", w(replied)]]);
  const tallies: Record<PipelineLaneId, Tally> = { outreach: outTally, reports: tallyOf(repRows), recoveries: tallyOf(recRows) };
  const lanes = LANE_SPECS.map((s) => buildLane(s, tallies[s.id], waiting[s.id]));
  return {
    lanes,
    ruleChanges: waiting.ruleChanges,
    ownerTasks: waiting.ownerTasks.count,
    ownerTasksCents: waiting.ownerTasks.cents,
    gateTotal: waiting.total,
  };
}
