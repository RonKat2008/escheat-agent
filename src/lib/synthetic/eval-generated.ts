import { clearedDateIndex, isStaleAt, resolveOwnerState } from "./labels";
import type { ClearRow, EvalCaseFixture, LedgerRow, SynthPropertyType } from "./model";
import { createRng } from "./prng";

const STALE_QUOTA = 40;
const OTHER_QUOTA: Record<SynthPropertyType, number> = {
  vendor_check: 66,
  payroll_check: 18,
  customer_credit: 20,
  unapplied_cash: 16,
};
export const GENERATED_CASE_COUNT = 160;

function toCase(row: LedgerRow, cleared: string | null, anchor: string): Omit<EvalCaseFixture, "id"> {
  const owner = resolveOwnerState(row);
  return {
    slice: "generated",
    item: {
      kind: row.kind,
      number: row.number,
      payee_name: row.payee_name,
      payee_address: row.payee_address,
      payee_city: row.payee_city,
      payee_state: row.payee_state,
      payee_zip: row.payee_zip,
      amount_cents: row.amount_cents,
      issue_date: row.issue_date,
      memo: row.memo,
      cleared_date: cleared,
    },
    expected: {
      property_type: row.kind,
      owner_state: owner.owner_state,
      owner_state_basis: owner.owner_state_basis,
      is_stale: isStaleAt({ issue_date: row.issue_date, voided: false, cleared_date: cleared }, anchor),
    },
  };
}

/** Deterministic stratified sample of non-voided ledger items: 40 stale + 120 others by kind quota. */
export function sampleGeneratedCases(
  ledger: readonly LedgerRow[],
  clears: readonly ClearRow[],
  anchor: string,
  seed: number,
): EvalCaseFixture[] {
  const rng = createRng(seed, "eval-generated");
  const idx = clearedDateIndex(clears);
  const live = ledger.filter((r) => !r.voided);
  const clearedOf = (r: LedgerRow) => idx.get(r.number) ?? null;
  const isStale = (r: LedgerRow) => isStaleAt({ issue_date: r.issue_date, cleared_date: clearedOf(r) }, anchor);
  const stale = rng.shuffle(live.filter(isStale)).slice(0, STALE_QUOTA);
  const taken = new Set(stale.map((r) => r.number));
  const chosen = [...stale];
  const rest = rng.shuffle(live.filter((r) => !isStale(r)));
  for (const kind of Object.keys(OTHER_QUOTA) as SynthPropertyType[]) {
    for (const r of rest.filter((x) => x.kind === kind).slice(0, OTHER_QUOTA[kind])) {
      chosen.push(r);
      taken.add(r.number);
    }
  }
  for (const r of rest) {
    if (chosen.length >= GENERATED_CASE_COUNT) break;
    if (!taken.has(r.number)) {
      chosen.push(r);
      taken.add(r.number);
    }
  }
  return rng
    .shuffle(chosen.slice(0, GENERATED_CASE_COUNT))
    .map((r, i) => ({ id: `gen-${String(i + 1).padStart(3, "0")}`, ...toCase(r, clearedOf(r), anchor) }));
}
