/**
 * R5-05: "Record remittance", the human step after filing. The app never moves money: a person pays the state outside
 * the app (synthetic demo data only) and records it here, with a date and an optional reference. The server requires
 * a typed approver, binds the approval to exactly the reported items, total, date and reference the person saw, and
 * consumes it once to move those items from `reported` to `remitted`. `remitted` is terminal: the overdue assessment,
 * late interest, the dashboard and Reports stop counting the items (src/lib/overdue.ts treats it as done).
 *
 * No DB migration: the approval row reuses the `submit_report` action under the subject `remit:<reportId>` (a report's
 * remittance is the second half of its filing obligation), so it cannot collide with the report's own submit approval.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { staleItems } from "@/db/schema";
import { approve, withApproval } from "@/lib/approvals";
import { now as clockNow } from "@/lib/clock";
import { isIsoDate } from "@/lib/dates";
import { listReportSummaries } from "@/lib/reports/service";
import { parseCloseOutState } from "./plan";
import type { RunnerRemittance } from "./runner-model";

export type RemittanceErrorCode = "not_filed" | "nothing_owed" | "changed" | "bad_date" | "future_date" | "bad_reference" | "no_approver";

const STATUS: Record<RemittanceErrorCode, number> = {
  not_filed: 409,
  nothing_owed: 409,
  changed: 409,
  bad_date: 400,
  future_date: 400,
  bad_reference: 400,
  no_approver: 400,
};

export class RemittanceError extends Error {
  readonly status: number;
  constructor(
    public readonly code: RemittanceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RemittanceError";
    this.status = STATUS[code];
  }
}

const LOCKED = new Set(["submitted", "confirmed"]);
export const REFERENCE_MAX = 80;

export interface RecordRemittanceInput {
  companyId: string;
  state: string;
  reportId: string;
  approvedBy: string;
  /** YYYY-MM-DD, not after the company's "today" (demo clock). */
  remittedOn: string;
  reference?: string | null;
  /** What the person saw: the server refuses if the reported items changed since. */
  expectedCount: number;
  expectedCents: number;
}

export interface RemittanceResult extends RunnerRemittance {
  approvalId: string;
  state: string;
}

interface RemittanceRecord {
  reportId: string;
  remittedOn: string;
  reference: string | null;
  by: string;
  recordedAt: string;
  approvalId: string;
}

/** Reported items of the state's latest submitted report (items carry no report link; the open cycle is the report's). */
export async function remittanceOwed(
  db: Db,
  companyId: string,
  stateInput: string,
): Promise<{ reportId: string; count: number; totalCents: number; itemIds: string[]; remitDue: string | null } | null> {
  const state = parseCloseOutState(stateInput);
  const latest = (await listReportSummaries(db, companyId)).find((s) => s.state === state)?.latest ?? null;
  if (!latest || !LOCKED.has(latest.status)) return null;
  const rows = await db
    .select({ id: staleItems.id, amountCents: staleItems.amountCents, remitDueDate: staleItems.remitDueDate })
    .from(staleItems)
    .where(and(eq(staleItems.companyId, companyId), eq(staleItems.ownerState, state), eq(staleItems.status, "reported")))
    .orderBy(staleItems.id);
  if (rows.length === 0) return null;
  return {
    reportId: latest.id,
    count: rows.length,
    totalCents: rows.reduce((a, r) => a + r.amountCents, 0),
    itemIds: rows.map((r) => r.id),
    remitDue: rows.map((r) => r.remitDueDate).filter((d): d is string => !!d).sort()[0] ?? null,
  };
}

function cleanReference(ref: string | null | undefined): string | null {
  const t = (ref ?? "").trim();
  if (!t) return null;
  if (t.length > REFERENCE_MAX || /[\u0000-\u001f]/.test(t)) throw new RemittanceError("bad_reference", `The reference must be one line of at most ${REFERENCE_MAX} characters.`);
  return t;
}

export async function recordRemittance(db: Db, input: RecordRemittanceInput, now: Date = new Date()): Promise<RemittanceResult> {
  const by = input.approvedBy.trim();
  if (!by) throw new RemittanceError("no_approver", "Type your name to record the remittance.");
  if (!isIsoDate(input.remittedOn)) throw new RemittanceError("bad_date", "The remittance date must be a date (YYYY-MM-DD).");
  const reference = cleanReference(input.reference);
  const state = parseCloseOutState(input.state);
  const today = await clockNow(db, input.companyId);
  if (input.remittedOn > today) throw new RemittanceError("future_date", "A remittance cannot be recorded for a date after today.");

  const owed = await remittanceOwed(db, input.companyId, state);
  if (!owed || owed.reportId !== input.reportId) {
    throw new RemittanceError(owed ? "not_filed" : "nothing_owed", owed ? "That report is not this state's filed report." : `Nothing is waiting to be remitted for ${state}: file the report first.`);
  }
  if (owed.count !== input.expectedCount || owed.totalCents !== input.expectedCents) {
    throw new RemittanceError("changed", "The reported items changed since you opened this. Reload and review the amount again.");
  }

  const payload = { reportId: owed.reportId, itemIds: owed.itemIds, totalCents: owed.totalCents, remittedOn: input.remittedOn, reference };
  const ref = { action: "submit_report" as const, subjectId: `remit:${owed.reportId}`, payload };
  const approval = await approve(db, { ...ref, approvedBy: by }, now);
  await withApproval(db, ref, async () => {
    const record: RemittanceRecord = { reportId: owed.reportId, remittedOn: input.remittedOn, reference, by, recordedAt: now.toISOString(), approvalId: approval.id };
    const moved = await db
      .update(staleItems)
      .set({
        status: "remitted",
        resolvedAt: new Date(`${input.remittedOn}T00:00:00.000Z`),
        classification: sql`coalesce(${staleItems.classification}, '{}'::jsonb) || ${JSON.stringify({ remittance: record })}::jsonb`,
      })
      .where(and(inArray(staleItems.id, owed.itemIds), eq(staleItems.status, "reported")))
      .returning({ id: staleItems.id });
    if (moved.length !== owed.itemIds.length) throw new RemittanceError("changed", "Some items changed while recording. Reload and try again.");
  });
  return { state, remittedOn: input.remittedOn, reference, by, itemCount: owed.count, totalCents: owed.totalCents, approvalId: approval.id };
}

/** The remittance recorded against a report, read back from its items (null when none). */
export async function loadRemittance(db: Db, companyId: string, state: string, reportId: string): Promise<RunnerRemittance | null> {
  const rows = await db
    .select({ amountCents: staleItems.amountCents, classification: staleItems.classification })
    .from(staleItems)
    .where(
      and(
        eq(staleItems.companyId, companyId),
        eq(staleItems.ownerState, state),
        eq(staleItems.status, "remitted"),
        sql`${staleItems.classification}->'remittance'->>'reportId' = ${reportId}`,
      ),
    );
  const first = rows[0]?.classification?.remittance as RemittanceRecord | undefined;
  if (!first) return null;
  return {
    remittedOn: first.remittedOn,
    reference: first.reference ?? null,
    by: first.by,
    itemCount: rows.length,
    totalCents: rows.reduce((a, r) => a + r.amountCents, 0),
  };
}
