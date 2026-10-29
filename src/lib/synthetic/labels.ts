/**
 * Labeling helpers for generator invariants and eval fixtures. They delegate to the PRODUCTION logic
 * (src/lib/rules/priority.ts for owner state, src/lib/recon/reconcile.ts for reconciliation and staleness)
 * so fixtures are asserted against what the pipeline really does. Only property-type classification
 * (memo rules for generic adversarial kinds) is local.
 */
import { reconKindOfPropertyType } from "../property-kinds";
import { reconcile, isStale, type ReconKind } from "../recon/reconcile";
import { resolveOwnerState as resolveProd } from "../rules/priority";
import {
  HOLDER_INCORPORATION_STATE,
  STALE_THRESHOLD_DAYS,
  type ClearRow,
  type LedgerRow,
  type SynthPropertyType,
} from "./model";

export interface AddressFields {
  payee_address: string;
  payee_city: string;
  payee_state: string;
  payee_zip: string;
}

export interface OwnerStateResult {
  owner_state: string;
  owner_state_basis: "address" | "incorporation";
  reason: string;
}

export function resolveOwnerState(
  a: AddressFields,
  holderState: string = HOLDER_INCORPORATION_STATE,
): OwnerStateResult {
  const r = resolveProd({
    payee: { address: a.payee_address, city: a.payee_city, state: a.payee_state, zip: a.payee_zip },
    holder: { stateOfIncorporation: holderState },
  });
  return { owner_state: r.state, owner_state_basis: r.basis, reason: r.reason };
}

const PAYROLL_MEMO = /payroll|wages?\b|salary|paycheck|net pay|bonus|commission|final pay/i;
const REFUND_MEMO = /refund|rebate|overpayment|credit/i;
const UNAPPLIED_MEMO = /unapplied|on account|deposit|prepayment|payment received/i;

/** Property-type labeling rule: direct kinds map to themselves; generic kinds use the memo. */
export function classifyPropertyType(kind: string, memo: string): SynthPropertyType {
  if (
    kind === "vendor_check" ||
    kind === "payroll_check" ||
    kind === "customer_credit" ||
    kind === "unapplied_cash"
  ) {
    return kind;
  }
  if (kind === "credit") return UNAPPLIED_MEMO.test(memo) ? "unapplied_cash" : "customer_credit";
  if (PAYROLL_MEMO.test(memo)) return "payroll_check";
  if (REFUND_MEMO.test(memo)) return "customer_credit";
  return "vendor_check";
}

export interface StaleInput {
  issue_date: string;
  voided?: boolean;
  cleared_date: string | null;
}

/** Stale = not voided, no clear on/before the anchor, and strictly more than the threshold days old. */
export function isStaleAt(
  item: StaleInput,
  anchor: string,
  thresholdDays: number = STALE_THRESHOLD_DAYS,
): boolean {
  if (item.voided) return false;
  if (item.cleared_date !== null && item.cleared_date <= anchor) return false;
  return isStale({ issueDate: item.issue_date }, anchor, thresholdDays);
}

export function clearedDateIndex(clears: readonly ClearRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of clears) {
    const prev = m.get(c.check_number);
    if (prev === undefined || c.cleared_date < prev) m.set(c.check_number, c.cleared_date);
  }
  return m;
}

export interface DemoStats {
  staleCount: number;
  staleTotalCents: number;
  byOwnerState: Record<string, number>;
  byOwnerStateCents: Record<string, number>;
  staleRows: LedgerRow[];
  ambiguousCount: number;
}

const RECON_KIND = (t: SynthPropertyType): ReconKind => reconKindOfPropertyType(t);

/** Runs the production reconcile() + isStale() over the dataset. */
export function computeDemoStats(
  ledger: readonly LedgerRow[],
  clears: readonly ClearRow[],
  anchor: string,
): DemoStats {
  const result = reconcile(
    ledger.map((r) => ({
      id: r.number,
      kind: RECON_KIND(r.kind),
      number: r.number,
      amountCents: r.amount_cents,
      issueDate: r.issue_date,
      voided: r.voided,
    })),
    clears.map((c, i) => ({
      id: `clear-${i}`,
      checkNumber: c.check_number,
      amountCents: c.amount_cents,
      clearedDate: c.cleared_date,
    })),
    anchor,
  );
  const byNumber = new Map(ledger.map((r) => [r.number, r]));
  const staleRows = result.outstanding
    .filter((o) => isStale(o, anchor, STALE_THRESHOLD_DAYS))
    .map((o) => byNumber.get(o.id) as LedgerRow);
  const byOwnerState: Record<string, number> = {};
  const byOwnerStateCents: Record<string, number> = {};
  for (const r of staleRows) {
    const { owner_state } = resolveOwnerState(r);
    byOwnerState[owner_state] = (byOwnerState[owner_state] ?? 0) + 1;
    byOwnerStateCents[owner_state] = (byOwnerStateCents[owner_state] ?? 0) + r.amount_cents;
  }
  return {
    staleCount: staleRows.length,
    staleTotalCents: staleRows.reduce((s, r) => s + r.amount_cents, 0),
    byOwnerState,
    byOwnerStateCents,
    staleRows,
    ambiguousCount: result.ambiguous.length,
  };
}
