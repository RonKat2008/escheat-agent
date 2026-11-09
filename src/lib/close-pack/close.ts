/**
 * R10-01: "Close <Month YYYY>". The irreversible step that makes a close pack a close:
 *   1. a person types their name; the server binds a `close_period` approval to the exact journal they saw
 *      (entry count, closing liability, sha256 of the entries) and consumes it once (src/lib/approvals.ts);
 *   2. the month's close pack is built, its manifest.json hash is appended to the audit chain as `period.closed`, and
 *      the month's journal entries plus the exact ZIP are frozen in `period_closes`, in one transaction.
 * After that the month's pack downloads byte-identical from the frozen ZIP, its journal entries never change, and items
 * detected later but dated inside it post to the next open month as labelled prior-period adjustments
 * (src/lib/ledger/closes.ts). Nothing is posted to any accounting system and no money moves.
 *
 * R11-01: the row also freezes a `snapshot` (the roll-forward per state and in total, the tie-out result, and every
 * movement the close covers). Every surface that shows a closed month reads it, never live totals.
 * R11-04: months close in order (rule and first-close choice documented in src/lib/ledger/closes.ts); the server
 * refuses any other month with 409 `out_of_order`, naming the month to close first.
 */
import { and, asc, eq } from "drizzle-orm";
import { APPROVER_REQUIRED_MESSAGE, isValidApproverName } from "@/lib/auth/approver";
import type { Db } from "@/db/client";
import { periodCloses } from "@/db/schema";
import { approve, assertReviewedHash, withApproval } from "@/lib/approvals";
import { appendAuditEvent, inTx } from "@/lib/audit/chain-db";
import { canonicalJson, sha256Hex } from "@/lib/crypto";
import { closedThrough, closeOrder, lastDayOf, nextOpenMonth, type CloseOrder, type Coverage } from "@/lib/ledger/closes";
import type { JournalEntry } from "@/lib/ledger/journal";
import type { Roll } from "@/lib/ledger/rollforward";
import { computeLedger, ledgerMovements, loadLedger, type LedgerData } from "@/lib/queries/ledger";
import { buildClosePack } from "./build";
import { firstActivityMonth, isMonthId, monthLabel, monthPeriod, monthsWithActivity } from "./period";

export type CloseErrorCode = "bad_period" | "already_closed" | "out_of_order" | "no_approver";

export class CloseError extends Error {
  readonly status: number;
  constructor(
    public readonly code: CloseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CloseError";
    this.status = code === "already_closed" || code === "out_of_order" ? 409 : 400;
  }
}

/** sha256 of the entries as they would be frozen (JSON round-trip first, so a stored copy hashes the same). */
export function journalDigest(entries: readonly JournalEntry[]): string {
  return sha256Hex(canonicalJson(JSON.parse(JSON.stringify(entries))));
}

export interface ClosePreview {
  period: string;
  label: string;
  entryCount: number;
  journalSha256: string;
  closingCents: number;
  /** The month has not ended on the demo clock: anything dated later in it will post to the next month. */
  notOver: boolean;
  /** Last day the close covers (the month's end, or the demo date when that comes first). */
  coversThrough: string;
  /** R11-04: why this month cannot be closed yet (months close in order), or null when it can. */
  blocked: string | null;
}

/** R11-01: what a close froze for display. Read by the Ask close card and the Ledger; never recomputed. */
export interface CloseSnapshot {
  version: 1;
  periodStart: string;
  periodEnd: string;
  states: Roll[];
  total: Roll;
  allTie: boolean;
  covered: Coverage;
}

export interface ClosedSummary {
  period: string;
  label: string;
  manifestSha256: string;
  chainSeq: number;
  closedBy: string;
  demoDate: string;
  /** The frozen roll-forward (null for a close recorded before migration 0016). */
  frozen: { openingCents: number; closingCents: number; states: Roll[]; total: Roll; allTie: boolean; periodStart: string; periodEnd: string } | null;
}

/** The user-facing reason a month cannot be closed under the in-order rule. */
export function closeOrderMessage(period: string, order: Exclude<CloseOrder, { ok: true }>, closed: readonly string[]): string {
  const through = closedThrough(closed)!;
  const next = order.nextClosable;
  if (order.reason === "inside_closed") {
    const postsTo = nextOpenMonth(through, new Set(closed));
    return (
      `${monthLabel(period)} is inside books already closed through ${monthLabel(through)}. Months close in order` +
      (next ? `; ${monthLabel(next)} is next` : "") +
      `. Anything dated in ${monthLabel(period)} now posts to ${monthLabel(postsTo)} as a prior-period adjustment.`
    );
  }
  return next
    ? `Close ${monthLabel(next)} first. Months close in order: ${monthLabel(next)} is the earliest open month with activity, and it must be closed before ${monthLabel(period)}.`
    : `${monthLabel(period)} cannot be closed yet: months close in order after ${monthLabel(through)}.`;
}

/** Why each month cannot be closed now (R11-04), for the months asked about. */
function orderBlocks(data: LedgerData, months: readonly string[]): Record<string, string | null> {
  const closed = (data.closes ?? []).map((c) => c.period);
  const activity = monthsWithActivity(ledgerMovements(data), data.today);
  return Object.fromEntries(
    months.map((ym) => {
      const order = closeOrder(ym, closed, activity);
      return [ym, order.ok ? null : closeOrderMessage(ym, order, closed)];
    }),
  );
}

/** What closing each open month would freeze, for the months offered on /ledger. Pure over the loaded ledger. */
export function closePreviews(data: LedgerData, months: readonly string[]): Record<string, ClosePreview> {
  const closed = new Set((data.closes ?? []).map((c) => c.period));
  const out: Record<string, ClosePreview> = {};
  const first = firstActivityMonth(ledgerMovements(data), data.today);
  const blocks = orderBlocks(data, months);
  for (const ym of months) {
    if (closed.has(ym)) continue;
    const p = monthPeriod(ym, data.today, first);
    if (!p.ok) continue;
    const view = computeLedger(data, "month", p.period);
    out[ym] = {
      period: ym,
      label: p.period.label,
      entryCount: view.journal.entries.length,
      journalSha256: journalDigest(view.journal.entries),
      closingCents: view.roll.total.closing,
      notOver: p.period.end === data.today && data.today < lastDayOf(ym),
      coversThrough: p.period.end,
      blocked: blocks[ym] ?? null,
    };
  }
  return out;
}

/** A stored snapshot, when well formed (closes before migration 0016 have none). */
export function parseSnapshot(v: unknown): CloseSnapshot | null {
  const o = v as Partial<CloseSnapshot> | null;
  if (!o || o.version !== 1 || !Array.isArray(o.states) || !o.total || typeof o.covered !== "object" || o.covered === null) return null;
  return o as CloseSnapshot;
}

export async function listClosedPeriods(db: Db, companyId: string): Promise<ClosedSummary[]> {
  const rows = await db
    .select({
      period: periodCloses.period,
      manifestSha256: periodCloses.manifestSha256,
      chainSeq: periodCloses.chainSeq,
      closedBy: periodCloses.closedBy,
      demoDate: periodCloses.demoDate,
      snapshot: periodCloses.snapshot,
    })
    .from(periodCloses)
    .where(eq(periodCloses.companyId, companyId))
    .orderBy(asc(periodCloses.period));
  return rows.map(({ snapshot, ...r }) => {
    const snap = parseSnapshot(snapshot);
    const frozen = snap
      ? { openingCents: snap.total.opening, closingCents: snap.total.closing, states: snap.states, total: snap.total, allTie: snap.allTie, periodStart: snap.periodStart, periodEnd: snap.periodEnd }
      : null;
    return { ...r, label: monthLabel(r.period), frozen };
  });
}

export interface FrozenPack {
  zip: Uint8Array;
  fileCount: number;
  allTie: boolean;
  manifestSha256: string;
  chainSeq: number;
}

/** The pack exactly as handed out when the month was closed, or null while the month is open. */
export async function loadClosedPack(db: Db, companyId: string, ym: string): Promise<FrozenPack | null> {
  const [row] = await db
    .select()
    .from(periodCloses)
    .where(and(eq(periodCloses.companyId, companyId), eq(periodCloses.period, ym)));
  if (!row) return null;
  return { zip: new Uint8Array(Buffer.from(row.packBase64, "base64")), fileCount: row.fileCount, allTie: row.allTie, manifestSha256: row.manifestSha256, chainSeq: row.chainSeq };
}

export interface ClosePeriodInput {
  companyId: string;
  period: string;
  approvedBy: string;
  /** What the person saw (ClosePreview.journalSha256): the server refuses if the month's journal changed since. */
  expectedJournalSha256: string;
}

export interface ClosePeriodResult extends ClosedSummary {
  approvalId: string;
  journalSha256: string;
  entryCount: number;
}

export async function closePeriod(db: Db, input: ClosePeriodInput, now: Date = new Date()): Promise<ClosePeriodResult> {
  const by = input.approvedBy.trim();
  if (!isValidApproverName(by)) throw new CloseError("no_approver", APPROVER_REQUIRED_MESSAGE);
  if (!isMonthId(input.period)) throw new CloseError("bad_period", "period must be YYYY-MM");
  const { companyId, period } = input;

  const data = await loadLedger(db, companyId);
  if ((data.closes ?? []).some((c) => c.period === period)) {
    throw new CloseError("already_closed", `${monthLabel(period)} is already closed. Its pack can be downloaded again; it cannot be re-closed.`);
  }
  const preview = closePreviews(data, [period])[period];
  if (!preview) {
    const why = monthPeriod(period, data.today, firstActivityMonth(ledgerMovements(data), data.today));
    throw new CloseError("bad_period", why.ok ? `${monthLabel(period)} cannot be closed` : why.error);
  }
  if (preview.blocked) throw new CloseError("out_of_order", preview.blocked);
  assertReviewedHash(input.expectedJournalSha256, preview.journalSha256, "month's journal");

  const payload = { companyId, period, journalSha256: preview.journalSha256, entryCount: preview.entryCount, closingCents: preview.closingCents };
  const ref = { action: "close_period" as const, subjectId: `close:${companyId}:${period}`, payload };
  const approval = await approve(db, { ...ref, approvedBy: by }, now);
  return withApproval(
    db,
    ref,
    async (_claimed, ctl) => {
      // The pack is built after the approval is on the chain, so its audit-chain head covers the approval itself.
      const built = await buildClosePack(db, companyId, period);
      if (!built.ok) throw new CloseError("bad_period", built.error);
      const { pack } = built;
      if (journalDigest(pack.journalEntries) !== preview.journalSha256) {
        // Nothing has been written yet, so the approval is released and the person reviews the new journal.
        throw Object.assign(new Error("The month's journal changed while closing. Reload and review it again."), { sideEffectNotPerformed: true });
      }
      const manifestFile = pack.files.find((f) => f.name === "manifest.json");
      if (!manifestFile) throw new Error("close pack has no manifest.json");
      const manifestSha256 = sha256Hex(manifestFile.data);
      const snapshot: CloseSnapshot = {
        version: 1,
        periodStart: pack.manifest.periodStart,
        periodEnd: pack.manifest.periodEnd,
        states: pack.roll.states,
        total: pack.roll.total,
        allTie: pack.manifest.tieOut.allTie,
        covered: pack.covered,
      };
      ctl.markAttempted();
      const closedAt = now;
      const row = await inTx(db, async (tx) => {
        const event = await appendAuditEvent(tx, {
          companyId,
          kind: "period.closed",
          subjectType: "period_close",
          subjectId: period,
          occurredAt: closedAt,
          payload: {
            period,
            manifestSha256,
            packSha256: sha256Hex(pack.zip),
            journalSha256: preview.journalSha256,
            entryCount: preview.entryCount,
            approvalId: approval.id,
            approvedBy: by,
            demoDate: data.today,
          },
        });
        await tx.insert(periodCloses).values({
          companyId,
          period,
          demoDate: data.today,
          closedAt,
          closedBy: by,
          approvalId: approval.id,
          journal: JSON.parse(JSON.stringify(pack.journalEntries)),
          journalSha256: preview.journalSha256,
          manifestSha256,
          manifest: new TextDecoder().decode(manifestFile.data),
          packBase64: Buffer.from(pack.zip).toString("base64"),
          fileCount: pack.files.length,
          allTie: pack.manifest.tieOut.allTie,
          chainSeq: event.seq,
          chainHash: event.hash,
          snapshot: JSON.parse(JSON.stringify(snapshot)),
        });
        return event;
      });
      return {
        period,
        label: monthLabel(period),
        manifestSha256,
        chainSeq: row.seq,
        closedBy: by,
        demoDate: data.today,
        approvalId: approval.id,
        journalSha256: preview.journalSha256,
        entryCount: preview.entryCount,
        frozen: {
          openingCents: snapshot.total.opening,
          closingCents: snapshot.total.closing,
          states: snapshot.states,
          total: snapshot.total,
          allTie: snapshot.allTie,
          periodStart: snapshot.periodStart,
          periodEnd: snapshot.periodEnd,
        },
      };
    },
    { now },
  );
}
