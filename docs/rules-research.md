# Escheat Agent rule files: CA, DE, TX (draft 2026.10.0-draft)

Researched 2026-10-29 from official statute text and state holder materials. **Every value has `verified: false`.** A human has to verify each one in the app before it counts as law. This is a prototype and is not legal advice.

Files: `CA.json`, `DE.json`, `TX.json`. The NAUPA file layout is in `../naupa-format.md`.

## Shapes used inside `RuleValue.value`

`RuleValue<T> = { value: T | null, sources: [{url, title, quote, retrieved_at}], verified: false, todo? }`

| Field | Shape |
|---|---|
| `propertyTypes.<key>` | keys: `vendor_check`, `payroll_check`, `customer_credit`, `unapplied_cash` |
| `clockStartsFrom` | `"issue_date"` \| `"last_owner_activity"` \| `"payable_date"` (details in todo) |
| `minAmountCents` / `aggregateThresholdCents` | integer cents. `aggregateThresholdCents: 2500` means items **below** 2500 cents may be aggregated |
| `reportStages[].asOfRule` | `{type:"fixed_cutoff", month, day}` or `{type:"fiscal_year_end"}` |
| `reportStages[].dueRule` | `{type:"fixed_date", month, day, yearOffset}` (yearOffset counts from the as-of year), or `{type:"after_stage", stage, months}`, or `{type:"after_stage_days", stage, days}` |
| `remitRule` | `{type:"with_report", stage}`, or a `fixed_date` / `after_stage` shape |
| `dueDiligence.windowDaysBeforeReport` | `{min, max}` in days, counted back from the due date of the FIRST report stage. `max: null` means the state sets no earliest date (TX) |
| `dueDiligence.minAmountCents` | the item value must be **>=** this amount (TX's "more than $250" is stored as 25001) |
| `interest` | `{annualRatePct, basis}`. DE's statutory rate is monthly (0.5%/mo). It is stored as 6 with a todo, and the engine should compute it monthly |

Quotes are verbatim text from the fetched page or PDF, with whitespace and line breaks collapsed. PDF quotes keep text-extraction artifacts such as `ClaimItT exas.gov` and the ligature glyphs in CA's code PDF. A script checked every DE, TX, NAUPA and SCO-PDF quote against the downloaded text. The CA statute quotes and the SCO HTML quotes were read in a real browser session (leginfo.legislature.ca.gov and sco.ca.gov block non-browser clients with Cloudflare) and transcribed from that output.

## Summary table

| | CA | DE | TX |
|---|---|---|---|
| **Vendor check** code / years / clock | CK13 / 3 / payable (§1520) | CK13 / 5 / payable (§1133(17)) | **MS04** / 3 / last owner activity (§72.101) |
| **Payroll** code / years / clock | MS01 / **1** / payable (§1513(a)(7)) | MS01 / 5 / payable (§1133(11)) | MS01 / **1** / last owner activity (§72.1015) |
| **Customer credit** code / years | MS09 / 3 (§1520) | MS09 / 5 (§1133(6) retail; (17) other) | MS09 / 3 |
| **Unapplied cash** code / years | MS06 / 3 (§1520) | MS06 / 5 (§1133(17)) | MS06 / 3 |
| Min reportable | $0 ("no minimum", SCO) | null (TODO) | null (TODO) |
| Aggregate allowed | items < $25 (§1530(b)(5)) | null (TODO; NAUPA chart says ≤$50) | items < $25 (§74.101(d)) |
| DD required / threshold | yes / ≥ $50 (§1520(b)) | yes / ≥ $50 (§1148) | yes / > $250 (§74.1011) |
| DD window | 6–12 **months** before notice report (≈183–365 d) | 60–120 days before filing | ≥ 60 days before delivery/due date (no earliest date) |
| DD method | mail, or e-mail with consent | first-class US mail | mail or e-mail |
| DD statutory language | heading "THE STATE OF CALIFORNIA REQUIRES US TO NOTIFY YOU…" + §1520(b) content | heading "Notice. The State of Delaware requires us to notify you…" + §1149(b) content | two required statements, no verbatim heading |
| Stages | **Notice** (as of FYE/June 30, due before Nov 1, no money), then **Remit** (June 1–15 of the next year, with money) | Annual (calendar year, as of Dec 31), due Mar 1 with money | Annual (cutoff Mar 1), due Jul 1 with money |
| Remit | with Remit Report | with report (contemporaneous) | with report |
| Weekend/holiday roll-forward | true (general CCP §12a) | null (TODO) | true (Comptroller) |
| Interest | 12%/yr (§1577) | 0.5%/mo, cap 50% (§1183) + penalties | 10%/yr (§74.705) + 5% + 5% penalty (§74.706) |
| Format | NAUPA II upload / manual | NAUPA II via web portal only (.rpt/.txt/.hrs) | NAUPA2 via secure file transfer (≤250 MB) |
| Portal | GoReport.sco.ca.gov | unclaimedproperty.delaware.gov > Submit a Report | ClaimItTexas.gov |

## Where the sources contradict the brief

1. **CK01 is not "vendor checks".** In the NAUPA II code list, CK01 is *Cashier's Checks* and **CK13 is *Vendor Checks*** (NAUPA spec p.17; DE Handbook p.57; CA SCO code list).
2. **MS04 is not payroll.** MS04 is *Payment(s) for Goods & Services*. Payroll is **MS01** (Wages, Payroll, Salary) in all three states.
3. **Texas does not use CK13 for ordinary companies.** The TX 2026 instructions (PDF p.40) say: "CK13 Vendor checks (For non-financial institution, please use MS04)". Northwind's vendor checks to Texas should therefore be coded **MS04**.
4. **California is two-stage. Confirmed.** CCP §1530(d) sets the Notice Report "before November 1 of each year as of June 30 or fiscal yearend next preceding". §1532(a) sets payment "no sooner than seven months and no later than seven months and 15 days after the final date for filing the report". SCO describes this as Notice Report (before Nov 1, no money) and Remit Report (June 1–15).
5. **CA due diligence is 6–12 months before the Notice Report.** It is not a 60–120-day window. The window is set in months (§1520(b)), so the engine should ideally use month arithmetic.
6. **CA §1577 at 12% is accurate**, but it is not absolute. It applies "unless that failure is due to reasonable cause". It is capped at $10,000 where the report and payment were timely but the report was deficient, and it is waivable under VCP.
7. **CA payroll dormancy is 1 year, not 3.** The same is true in TX. DE is 5 years for every v1 type.
8. **TX due diligence threshold is "more than $250"**, not $50. TX also allows **e-mail** notice and sets only a latest date (60 days), with no window.
9. **Due-diligence anchors differ by state.** DE's statute counts back from *filing* the report, and the DE handbook variously says "reporting deadline" and "becomes reportable". TX's statute counts from *delivery*, and the Comptroller counts from the due date. The rule files anchor each window on the first stage's due date, and each todo records the difference.

## All TODOs (human review queue)

**CA**
- vendor_check.naupaCode: CK13 vs MS04/MS08 for a non-bank AP check. SCO does not say which to use.
- vendor_check.clockStartsFrom: "payable or distributable" is mapped to the issue date.
- vendor_check.aggregateThresholdCents: note that SCO encourages detail on every item.
- customer_credit.naupaCode: MS09 vs MS05/MS07/MS11.
- customer_credit.clockStartsFrom: when a credit becomes "payable" under §1520.
- unapplied_cash.naupaCode: quote contains PDF ligature artifacts.
- unapplied_cash.clockStartsFrom: no specific rule exists. Owner is usually unknown, so the holder-domicile priority applies.
- dueDiligence.required: is DD legally required for **wages**? §1520(b) covers only §1520 property, and §1513.5 covers banks only. SCO guidance applies DD to everything ≥ $50.
- dueDiligence.windowDaysBeforeReport: the rule is in months. The days are approximate.
- dueDiligence.mailingMethod: class of mail is not specified.
- dueDiligence.requiredLanguage: full §1520(b) content list. The template needs legal review.
- reportStages.notice.asOfRule: needs the holder's FYE. Default to June 30.
- reportStages.notice.dueRule: yearOffset depends on the FYE.
- reportStages.remit.asOfRule: same properties as the Notice Report.
- reportStages.remit.dueRule: June 1–15 window. The holder-specific date comes on the 14F letter.
- remitRule: EFT is required for cash ≥ $2,000.
- businessDayRollForward: the general CCP §12a rule applies. SCO does not restate it.
- interest: reasonable-cause exception and §1576 fines.

**DE**
- minAmountCents (all four types): unknown.
- aggregateThresholdCents (all four types): unknown. Only NAUPA's secondary chart gives a figure ($50).
- vendor_check.naupaCode: CK13 vs MS04/MS08.
- vendor_check / unapplied_cash.clockStartsFrom: §1133(17) catch-all.
- customer_credit.naupaCode: MS09 vs MS05/MS07/MS11.
- customer_credit.clockStartsFrom: retail (§1133(6)) vs non-retail (§1133(17)).
- dueDiligence.windowDaysBeforeReport: filing date vs deadline anchor.
- reportStages.annual: bank and insurer dates differ. Extension requests are due ≥ 15 days before the deadline.
- businessDayRollForward: unknown.
- interest: rate is monthly. The waiver policy needs checking.
- electronicFormat: aggregate owner-type code is "AG" in the handbook but "AP" in the NAUPA spec.
- notes: review **84 Del. Laws c. 368**. Its application notes are attached to §§1130, 1144 and 1150.

**TX**
- minAmountCents (all four types): unknown.
- aggregateThresholdCents: note that TX discourages aggregation.
- vendor_check.naupaCode: the quote spans a PDF line break.
- clockStartsFrom (all four types): last contact, in practice the issue date.
- customer_credit.naupaCode: alternatives.
- unapplied_cash: no owner address.
- dueDiligence.required: exceptions.
- dueDiligence.minAmountCents: the 25001 encoding.
- dueDiligence.windowDaysBeforeReport: max = null, and delivery vs due date.
- dueDiligence.requiredLanguage: content only, no verbatim text.
- dueDiligence.mailingMethod: class of mail not specified.
- interest: waiver.
- portal: extraction artifact in the quote.

## Confidence notes
- **High.** Statute-backed values quoted directly: dormancy years, report and remit dates, DD thresholds and windows, interest rates. TX and DE come from official statute text plus the current handbooks (TX 2026 Reporting Instructions; DE Holder Handbook, August 2026 v1).
- **Medium.** CA statute text was read in a browser because of Cloudflare and was not machine-checked. The NAUPA code chosen for vendor checks, customer credits and unapplied cash involves judgment, because each state lists several plausible codes. The `clockStartsFrom` mapping simplifies statutes worded as "payable" or "last contact".
- **Low / unknown.** Minimum amounts and aggregates for DE and TX. DE's weekend roll-forward. Whether CA §12a is applied to SCO deadlines.
- NAUPA's state pages (unclaimed.org/reporting/&lt;state&gt;/) are used **only as corroboration** and never as the sole source of a value.
