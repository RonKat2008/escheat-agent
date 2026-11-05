/**
 * "Horizon said so": forecast vs actual for a forward demo-clock move (pure, client-safe).
 *
 * At move time (inside moveDemoClock's transaction, see check-capture.ts) we store a small snapshot: the payments the
 * Horizon projection listed as going stale by the new day, computed as of the previous day with the same getHorizon()
 * the page uses, and the payments the move actually detected. Re-running the projection later would not be exact (items
 * clear, get detected or pruned afterwards), so the snapshot is the record. This module compares the two sets and
 * attaches a reason to every difference only when the snapshot knows it; otherwise it says "not recorded".
 */

/** One payment in a snapshot (ledger item id, cents, and enough to label it). */
export interface CheckRow {
  /** ledger_items.id */
  id: string;
  cents: number;
  check: string | null;
  payee: string;
  /** Owner state as read at the time (provisional for predictions, classified for detections); null = unknown. */
  state: string | null;
}

export interface DetectedRow extends CheckRow {
  /** stale_items.id created by the move. */
  itemId: string;
  /** First stale day (stale_items.stale_since). */
  staleOn: string;
}

/** Why a predicted payment was not detected, as observed right after the move's detection ran. */
export type MissReason = "cleared" | "voided" | "ambiguous" | "in_pipeline" | "not_stale" | "unknown";

export interface PredictionSnapshot {
  v: 1;
  /** Demo day the forecast was made on (the clock's previous day). */
  asOf: string;
  /** Demo day the clock moved to. */
  by: string;
  thresholdDays: number;
  predicted: CheckRow[];
  detected: DetectedRow[];
  /** For predicted ids that were not detected: what was true right after the move. */
  misses: { id: string; why: MissReason; on: string | null; itemId: string | null }[];
}

export type MatchStatus = "all" | "differences";

export interface MatchedRow extends DetectedRow {
  /** Honest note on a matched row, e.g. no rule file for its state. */
  note: string | null;
}

export interface DiffRow extends CheckRow {
  /** Link target (stale_items.id) when the payment is in the pipeline; null when there is no item page. */
  itemId: string | null;
  reason: string;
}

export interface Reconciliation {
  asOf: string;
  by: string;
  predicted: { count: number; cents: number };
  detected: { count: number; cents: number };
  matched: MatchedRow[];
  /** Predicted but not detected. */
  missed: DiffRow[];
  /** Detected but not predicted. */
  unexpected: DiffRow[];
  status: MatchStatus;
}

const sum = (rows: readonly { cents: number }[]) => rows.reduce((s, r) => s + r.cents, 0);

export function missReasonText(why: MissReason, on: string | null, formatDay: (d: string) => string): string {
  switch (why) {
    case "cleared":
      return on ? `Cleared at the bank on ${formatDay(on)}, between the forecast and the move.` : "Cleared at the bank between the forecast and the move.";
    case "voided":
      return "Voided in the ledger after the forecast.";
    case "ambiguous":
      return "A bank clear may belong to it, so reconciliation holds it as ambiguous and detection skips it.";
    case "in_pipeline":
      return "Already in the pipeline before this move ran (added by another detection run or a person).";
    case "not_stale":
      return "Still under the stale line on the new date.";
    case "unknown":
      return "Not detected; the reason was not recorded.";
  }
}

/** Matched rows whose state has no rule file are still stale (business policy), but have no legal dates. */
function matchNote(row: CheckRow, ruleStates: ReadonlySet<string>): string | null {
  if (!row.state) return "No owner state in the address: detected as needs-review, no legal dates.";
  if (!ruleStates.has(row.state)) return `No rules for ${row.state} yet: detected as needs-rule, no legal dates.`;
  return null;
}

export function reconcilePrediction(snap: PredictionSnapshot, ruleStates: readonly string[], formatDay: (d: string) => string = (d) => d): Reconciliation {
  const rules = new Set(ruleStates);
  const predictedIds = new Set(snap.predicted.map((p) => p.id));
  const detectedById = new Map(snap.detected.map((d) => [d.id, d]));
  const missById = new Map(snap.misses.map((m) => [m.id, m]));

  const matched: MatchedRow[] = snap.detected.filter((d) => predictedIds.has(d.id)).map((d) => ({ ...d, note: matchNote(d, rules) }));
  const missed: DiffRow[] = snap.predicted
    .filter((p) => !detectedById.has(p.id))
    .map((p) => {
      const m = missById.get(p.id);
      return { ...p, itemId: m?.itemId ?? null, reason: missReasonText(m?.why ?? "unknown", m?.on ?? null, formatDay) };
    });
  const unexpected: DiffRow[] = snap.detected
    .filter((d) => !predictedIds.has(d.id))
    .map((d) => ({
      ...d,
      reason:
        d.staleOn <= snap.asOf
          ? `Already past the stale line on ${formatDay(snap.asOf)} and waiting for detection; Horizon lists only payments not yet stale.`
          : `Not on Horizon's list on ${formatDay(snap.asOf)}; the reason was not recorded.`,
    }));

  const status: MatchStatus = missed.length === 0 && unexpected.length === 0 ? "all" : "differences";
  return {
    asOf: snap.asOf,
    by: snap.by,
    predicted: { count: snap.predicted.length, cents: sum(snap.predicted) },
    detected: { count: snap.detected.length, cents: sum(snap.detected) },
    matched,
    missed,
    unexpected,
    status,
  };
}

/** Narrow an untyped jsonb value to a snapshot; anything else is "not recorded" (null), never guessed. */
export function parseSnapshot(value: unknown): PredictionSnapshot | null {
  const v = value as Partial<PredictionSnapshot> | null;
  if (!v || v.v !== 1 || typeof v.asOf !== "string" || typeof v.by !== "string") return null;
  if (!Array.isArray(v.predicted) || !Array.isArray(v.detected) || !Array.isArray(v.misses)) return null;
  return v as PredictionSnapshot;
}

/** A row ready to render: a link to its item page when that item still exists, otherwise why not. */
export interface LinkedRow extends CheckRow {
  href: string | null;
  /** Shown under the row: the difference's reason, or a note on a matched row. */
  note: string | null;
}

export interface LinkedReconciliation extends Omit<Reconciliation, "matched" | "missed" | "unexpected"> {
  matched: LinkedRow[];
  missed: LinkedRow[];
  unexpected: LinkedRow[];
}

const GONE = "No longer in the pipeline (the clock moved back before its stale date, or was reset), so there is no item page.";
const NO_PAGE = "Not in the pipeline, so there is no item page.";

const strip = (r: CheckRow): CheckRow => ({ id: r.id, cents: r.cents, check: r.check, payee: r.payee, state: r.state });

/** Link each row to /items?item=<stale item id> only when that item exists now; say why when it does not. */
export function linkRows(rec: Reconciliation, liveItemIds: ReadonlySet<string>): LinkedReconciliation {
  const link = (row: CheckRow, itemId: string | null, note: string | null, whenMissing: string): LinkedRow => {
    if (itemId && liveItemIds.has(itemId)) return { ...strip(row), href: `/items?item=${itemId}`, note };
    return { ...strip(row), href: null, note: note ? `${note} ${whenMissing}` : whenMissing };
  };
  return {
    ...rec,
    matched: rec.matched.map((r) => link(r, r.itemId, r.note, GONE)),
    missed: rec.missed.map((r) => link(r, r.itemId, r.reason, r.itemId ? GONE : NO_PAGE)),
    unexpected: rec.unexpected.map((r) => link(r, r.itemId, r.reason, GONE)),
  };
}
