/**
 * R10-01: "Close <Month YYYY>". The irreversible step that makes a close pack a close:
 *   1. a person types their name; the server binds a `close_period` approval to the exact journal they saw
 *      (entry count, closing liability, sha256 of the entries) and consumes it once (src/lib/approvals.ts);
 *   2. the month's close pack is built, its manifest.json hash is appended to the audit chain as `period.closed`, and
 *      the month's journal entries plus the exact ZIP are frozen in `period_closes`, in one transaction.
 * After that the month's pack downloads byte-identical from the frozen ZIP, its journal entries never change, and items
 * detected later but dated inside it post to the next open month as labelled prior-period adjustments
 * (src/lib/ledger/closes.ts). Nothing is posted to any accounting system and no money moves.
 */
import { and, asc, eq } from "drizzle-orm";
import { APPROVER_REQUIRED_MESSAGE, isValidApproverName } from "@/lib/auth/approver";
import type { Db } from "@/db/client";
import { periodCloses } from "@/db/schema";
import { approve, assertReviewedHash, withApproval } from "@/lib/approvals";
import { appendAuditEvent, inTx } from "@/lib/audit/chain-db";
import { canonicalJson, sha256Hex } from "@/lib/crypto";
import type { JournalEntry } from "@/lib/ledger/journal";
import { computeLedger, ledgerMovements, loadLedger, type LedgerData } from "@/lib/queries/ledger";
import { buildClosePack } from "./build";
import { firstActivityMonth, isMonthId, monthLabel, monthPeriod } from "./period";

export type CloseErrorCode = "bad_period" | "already_closed" | "no_approver";

export class CloseError extends Error {
  readonly status: number;
  constructor(
    public readonly code: CloseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CloseError";
    this.status = code === "already_closed" ? 409 : 400;
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
}

export interface ClosedSummary {
  period: string;
  label: string;
  manifestSha256: string;
  chainSeq: number;
  closedBy: string;
  demoDate: string;
}

/** What closing each open month would freeze, for the months offered on /ledger. Pure over the loaded ledger. */
export function closePreviews(data: LedgerData, months: readonly string[]): Record<string, ClosePreview> {
  const closed = new Set((data.closes ?? []).map((c) => c.period));
  const out: Record<string, ClosePreview> = {};
  const first = firstActivityMonth(ledgerMovements(data), data.today);
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
      notOver: p.period.end === data.today && data.today < lastDay(ym),
      coversThrough: p.period.end,
    };
  }
  return out;
}

function lastDay(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

export async function listClosedPeriods(db: Db, companyId: string): Promise<ClosedSummary[]> {
  const rows = await db
    .select({
      period: periodCloses.period,
      manifestSha256: periodCloses.manifestSha256,
      chainSeq: periodCloses.chainSeq,
      closedBy: periodCloses.closedBy,
      demoDate: periodCloses.demoDate,
    })
    .from(periodCloses)
    .where(eq(periodCloses.companyId, companyId))
    .orderBy(asc(periodCloses.period));
  return rows.map((r) => ({ ...r, label: monthLabel(r.period) }));
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
      };
    },
    { now },
  );
}
