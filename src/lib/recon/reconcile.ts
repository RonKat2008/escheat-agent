import { daysBetween } from "./days";

export type ReconKind = "check" | "credit" | "unapplied_cash";

export interface ReconLedgerItem {
  id: string;
  kind: ReconKind;
  /** check number; checks without one can only match unnumbered clears */
  number?: string | null;
  amountCents: number;
  issueDate: string; // YYYY-MM-DD
  voided: boolean;
}

export interface ReconClear {
  id: string;
  checkNumber?: string | null;
  amountCents: number;
  clearedDate: string; // YYYY-MM-DD
}

export interface ReconcileOptions {
  /** Max days after issue that an unnumbered clear may still match by amount. Default 365. */
  maxClearDays?: number;
  /**
   * When several checks could own an unnumbered clear, the closest wins only if it is
   * more than this many days closer than the runner-up; otherwise ambiguous. Default 0 (strict tie).
   */
  ambiguityMarginDays?: number;
}

export type MatchMethod = "number_and_amount" | "amount_and_date";
export type AmbiguousReason = "amount_mismatch" | "multiple_candidate_clears" | "multiple_candidate_checks";

export interface Match {
  ledgerId: string;
  clearId: string;
  method: MatchMethod;
}

export interface Ambiguous {
  ledgerId: string;
  candidates: string[]; // clear ids
  reason: AmbiguousReason;
}

export type Outstanding<L extends ReconLedgerItem> = L & { ageDays: number };

export interface ReconcileResult<L extends ReconLedgerItem, C extends ReconClear> {
  matched: Match[];
  /** Non-voided items with no clear as of `asOf` (ambiguous items are NOT included). */
  outstanding: Outstanding<L>[];
  voided: L[];
  ambiguous: Ambiguous[];
  /** Clears (on or before asOf) that matched nothing. Clears after asOf are ignored entirely. */
  unmatchedClears: C[];
}

const DEFAULT_MAX_CLEAR_DAYS = 365;

function normNumber(n: string | null | undefined): string | null {
  const s = (n ?? "").trim().toUpperCase().replace(/^0+(?=.)/, "");
  return s === "" ? null : s;
}

/** Business staleness: strictly more than `thresholdDays` old. Exactly the threshold is not stale. */
export function isStale(item: { issueDate: string }, asOf: string, thresholdDays: number): boolean {
  return daysBetween(item.issueDate, asOf) > thresholdDays;
}

export function reconcile<L extends ReconLedgerItem, C extends ReconClear>(
  ledger: readonly L[],
  clears: readonly C[],
  asOf: string,
  opts: ReconcileOptions = {},
): ReconcileResult<L, C> {
  const maxClearDays = opts.maxClearDays ?? DEFAULT_MAX_CLEAR_DAYS;
  const margin = opts.ambiguityMarginDays ?? 0;

  const matched: Match[] = [];
  const ambiguous: Ambiguous[] = [];
  const voided: L[] = [];
  const claimedClears = new Set<string>(); // matched or flagged ambiguous
  const settled = new Set<string>(); // ledger ids matched or ambiguous

  const eligible = clears
    .filter((c) => c.clearedDate <= asOf)
    .sort((a, b) => a.clearedDate.localeCompare(b.clearedDate) || a.id.localeCompare(b.id));

  const live = ledger.filter((l) => l.issueDate <= asOf);
  for (const l of live) if (l.voided) voided.push(l);
  const open = live.filter((l) => !l.voided);
  // Amount-only matching (Phase B) is limited to checks; any numbered item, including a credit
  // refunded or unapplied cash returned by a payment carrying the same reference, can match by number.
  const checks = open.filter((l) => l.kind === "check");

  /* ---- Phase A: numbered checks ---- */
  const clearsByNumber = new Map<string, C[]>();
  for (const c of eligible) {
    const n = normNumber(c.checkNumber);
    if (n) clearsByNumber.set(n, [...(clearsByNumber.get(n) ?? []), c]);
  }
  const exactFor = new Map<string, C[]>(); // ledger id -> exact candidates (date >= issue)
  const claimCount = new Map<string, number>(); // clear id -> number of checks claiming it
  const numbered = open.filter((l) => normNumber(l.number));
  for (const l of numbered) {
    const pool = clearsByNumber.get(normNumber(l.number)!) ?? [];
    const exact = pool.filter((c) => c.amountCents === l.amountCents && c.clearedDate >= l.issueDate);
    exactFor.set(l.id, exact);
    for (const c of exact) claimCount.set(c.id, (claimCount.get(c.id) ?? 0) + 1);
  }
  for (const l of numbered) {
    const pool = clearsByNumber.get(normNumber(l.number)!) ?? [];
    const exact = exactFor.get(l.id) ?? [];
    if (exact.length > 0) {
      if (exact.some((c) => (claimCount.get(c.id) ?? 0) > 1)) {
        ambiguous.push({ ledgerId: l.id, candidates: exact.map((c) => c.id), reason: "multiple_candidate_checks" });
        for (const c of exact) claimedClears.add(c.id);
      } else {
        // earliest clear wins; later duplicates stay in unmatchedClears
        matched.push({ ledgerId: l.id, clearId: exact[0]!.id, method: "number_and_amount" });
        claimedClears.add(exact[0]!.id);
      }
      settled.add(l.id);
      continue;
    }
    const mismatched = pool.filter((c) => c.amountCents !== l.amountCents && c.clearedDate >= l.issueDate);
    if (mismatched.length > 0) {
      ambiguous.push({ ledgerId: l.id, candidates: mismatched.map((c) => c.id), reason: "amount_mismatch" });
      for (const c of mismatched) claimedClears.add(c.id);
      settled.add(l.id);
    }
  }

  /* ---- Phase B: unnumbered clears by amount + date proximity ---- */
  for (const c of eligible) {
    if (claimedClears.has(c.id) || normNumber(c.checkNumber)) continue;
    const cands = checks
      .filter(
        (l) =>
          !settled.has(l.id) &&
          l.amountCents === c.amountCents &&
          c.clearedDate >= l.issueDate &&
          daysBetween(l.issueDate, c.clearedDate) <= maxClearDays,
      )
      .map((l) => ({ l, gap: daysBetween(l.issueDate, c.clearedDate) }))
      .sort((a, b) => a.gap - b.gap);
    if (cands.length === 0) continue;
    const [best, second] = cands;
    claimedClears.add(c.id);
    if (!second || second.gap - best!.gap > margin) {
      matched.push({ ledgerId: best!.l.id, clearId: c.id, method: "amount_and_date" });
      settled.add(best!.l.id);
    } else {
      const tied = cands.filter((x) => x.gap - best!.gap <= margin);
      for (const t of tied) {
        ambiguous.push({ ledgerId: t.l.id, candidates: [c.id], reason: "multiple_candidate_checks" });
        settled.add(t.l.id);
      }
    }
  }

  const outstanding: Outstanding<L>[] = live
    .filter((l) => !l.voided && !settled.has(l.id))
    .map((l) => ({ ...l, ageDays: daysBetween(l.issueDate, asOf) }));

  return {
    matched,
    outstanding,
    voided,
    ambiguous,
    unmatchedClears: eligible.filter((c) => !claimedClears.has(c.id)),
  };
}
