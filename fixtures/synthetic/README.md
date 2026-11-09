# SYNTHETIC demo data - Northwind Fixtures, Inc.

Everything in this directory is **SYNTHETIC**. The company, payees, addresses, amounts, check numbers
and memos are fictional and generated deterministically (mulberry32, default seed 10482). No real
businesses, people, SSNs/TINs or bank numbers. Regenerate with `pnpm gen:synthetic` (same seed gives
byte-identical files).

- `ledger.csv` - kind, number, payee_name, payee_address, payee_city, payee_state, payee_zip, amount
  (dollars, e.g. `2340.00`), issue_date, voided, memo. About 700-750 items over the 3 years before the
  demo anchor date 2026-11-01. `kind` is one of vendor_check, payroll_check, customer_credit,
  unapplied_cash.
- `bank_clears.csv` - check_number, amount, cleared_date, description. Matches ledger `number`.

Holder: Northwind Fixtures, Inc., incorporated Delaware, HQ Austin TX (fictional street), FY end 12-31.

Demo invariants at the anchor (stale = not voided, no clear on/before the anchor, issued more than
180 days before it): 47 stale items, $61,915.00, owner states CA 21 / TX 15 / DE 11 (DE includes items
with no usable address, which fall back to the incorporation state). Featured: check 10482, $2,340.00,
"Bayline Electric", CA address, issued 2025-09-01, never cleared.

Deliberate mess: payee name variants ("Bayline Electric" / "Bayline Electric Inc." / "BAYLINE ELEC"),
voided checks with reissues, checks that cleared 60-200 days late, same-amount checks on different
numbers (including cleared twins of stale items - match on number, not amount), city-only / ZIP-only /
blank / state-inside-street-line addresses, a Canadian payee, and other-state payees (NY, WA, IL, FL,
AZ, GA, OR) whose items are all cleared or not yet stale.

- `ask-upload-sample.csv` - SYNTHETIC, hand-written (not generated): 6 check-register rows with non-standard headers
  (Chk No, Vendor, Date Issued, an unmapped Department column) for the Ask upload card (tests/e2e/ui-ask-cards.spec.ts).
  Two rows are deliberately bad (an amount that is not a number, a date after the demo anchor) so the preview shows
  row-level errors. Fictional payees and addresses; check numbers 90001-90006 do not collide with ledger.csv.
