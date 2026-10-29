# Eval set - SYNTHETIC

200 labeled cases: `cases.generated.json` (160, sampled deterministically from the generated ledger:
40 stale items plus 120 others stratified by kind) and `cases.adversarial.json` (40 hand-written).
Both files are plain JSON arrays. Everything is fictional.

```
{ id, slice: "generated" | "adversarial",
  item: { kind, number, payee_name, payee_address, payee_city, payee_state, payee_zip,
          amount_cents, issue_date, memo, cleared_date: string | null },
  expected: { property_type, owner_state, owner_state_basis: "address" | "incorporation", is_stale } }
```

`cleared_date` is the bank-clearing snapshot. `is_stale` is evaluated at the demo anchor 2026-11-01
with a 180-day threshold. Holder: Northwind Fixtures, Inc. (incorporated DE).

## Labeling rules

**is_stale** - true iff the item is not voided, has no clear dated on or before the anchor (a clear dated
after the anchor does not count), and anchor minus issue date is strictly greater than 180 days
(exactly 180 days is NOT stale).

**property_type** - `kind` of `vendor_check`, `payroll_check`, `customer_credit` or `unapplied_cash` is
the label. Adversarial cases may use generic kinds: `credit` -> `unapplied_cash` if the memo mentions
unapplied / on account / deposit / prepayment / payment received, else `customer_credit`; `check` ->
`payroll_check` if the memo mentions payroll / wages / salary / paycheck / net pay / bonus / commission /
final pay, else `customer_credit` if it mentions refund / rebate / overpayment / credit, else
`vendor_check` (payroll is tested first).

**owner_state** (priority rule: payee address state if a US state is determinable, else the holder's
incorporation state DE; `owner_state_basis` is `address` or `incorporation` accordingly):

1. Military addresses (APO/FPO/DPO text, state AA/AE/AP, military ZIP ranges) and non-US addresses
   (Canadian province or postal code, other country names) are not a US state. Simplification, as
   coded: they fall back to the incorporation state DE (basis `incorporation`).
2. Otherwise an explicit state field wins (abbreviation in any case, full name, common variants such as
   "Calif", and typos within 1-2 edits of a full name such as "Califronia", unique match only). It beats
   a conflicting city or ZIP.
3. Otherwise a state at the end of the city field or street line ("Sacramento, Calif.", "Austin Tex",
   "..., Fresno CA 93721"). A bare two-letter code in the street line counts only after a comma or before
   a ZIP (so "12 Vista CT" is a street, not Connecticut); a state name in the middle of a street name
   ("Oregon Trail Rd") and a lone city word do not count.
4. Otherwise the state implied by the ZIP prefix (5 digits, ZIP+4, or 4 digits with a lost leading zero).
5. Otherwise DE by incorporation. A city alone never determines a state. Placeholders ("N/A") and
   whitespace count as empty.

The same rules are implemented in `src/lib/synthetic/labels.ts`; adversarial labels were written by
hand and `eval.test.ts` checks every case against that helper.
