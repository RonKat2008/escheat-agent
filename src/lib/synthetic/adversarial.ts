import type { EvalCaseFixture, EvalItem } from "./model";

type Expected = EvalCaseFixture["expected"];
type ItemPatch = Partial<EvalItem>;

interface Spec {
  note: string;
  item: ItemPatch;
  /** [owner_state, basis] */
  owner: readonly [string, "address" | "incorporation"];
  expected?: Partial<Expected>;
}

const BLANK = { payee_address: "", payee_city: "", payee_state: "", payee_zip: "" };
const INC = "incorporation" as const;
const ADDR = "address" as const;

/**
 * 40 hand-written, hand-labeled adversarial cases (SYNTHETIC). Labels follow fixtures/eval/README.md,
 * and were written by hand; labels.test.ts checks them against the local labeling helper.
 * Defaults: vendor_check, issued 2025-03-14, never cleared (=> stale at the 2026-11-01 anchor).
 */
export const ADVERSARIAL_SPECS: readonly Spec[] = [
  { note: "state abbreviation with period in city field", item: { ...BLANK, payee_city: "Sacramento, Calif." }, owner: ["CA", ADDR] },
  { note: "no comma before state word", item: { ...BLANK, payee_city: "Austin Tex" }, owner: ["TX", ADDR] },
  { note: "state and ZIP only inside the street line", item: { ...BLANK, payee_address: "88 Harbor Rd, Fresno CA 93721" }, owner: ["CA", ADDR] },
  { note: "state inside street line, suite before city", item: { ...BLANK, payee_address: "1200 Main St Suite 4, Houston TX 77002" }, owner: ["TX", ADDR] },
  { note: "state name inside street name is not a state", item: { ...BLANK, payee_address: "45 Oregon Trail Rd", payee_city: "Springfield" }, owner: ["DE", INC] },
  { note: "CT as street suffix (Court) is not Connecticut", item: { ...BLANK, payee_address: "12 Vista CT", payee_city: "Columbus" }, owner: ["DE", INC] },
  { note: "ZIP only (CA); issued on the last stale day", item: { ...BLANK, payee_zip: "94203", issue_date: "2026-05-04" }, owner: ["CA", ADDR] },
  { note: "ZIP only (TX); exactly 180 days old is NOT stale", item: { ...BLANK, payee_zip: "78701", issue_date: "2026-05-05" }, owner: ["TX", ADDR], expected: { is_stale: false } },
  { note: "ZIP only (DE); cleared 200 days late but before anchor", item: { ...BLANK, payee_zip: "19801", issue_date: "2025-11-03", cleared_date: "2026-05-22" }, owner: ["DE", ADDR], expected: { is_stale: false } },
  { note: "ZIP+4 only (NY); clear dated after the anchor does not count", item: { ...BLANK, payee_zip: "10001-4411", cleared_date: "2026-11-15" }, owner: ["NY", ADDR] },
  { note: "4-digit ZIP lost its leading zero (MA)", item: { ...BLANK, payee_zip: "2134" }, owner: ["MA", ADDR] },
  { note: "PO box with city and state", item: { ...BLANK, payee_address: "PO Box 4412", payee_city: "Tacoma", payee_state: "WA" }, owner: ["WA", ADDR] },
  { note: "PO box only, no locality", item: { ...BLANK, payee_address: "P.O. Box 77" }, owner: ["DE", INC] },
  { note: "APO (AE) is not a state", item: { payee_address: "PSC 802 Box 1234", payee_city: "APO", payee_state: "AE", payee_zip: "09012" }, owner: ["DE", INC] },
  { note: "FPO (AP) is not a state", item: { payee_address: "Unit 5 Box 220", payee_city: "FPO", payee_state: "AP", payee_zip: "96601" }, owner: ["DE", INC] },
  { note: "DPO (AA) is not a state", item: { payee_address: "Unit 7 Box 11", payee_city: "DPO", payee_state: "AA", payee_zip: "34038" }, owner: ["DE", INC] },
  { note: "Canadian address, province field", item: { payee_address: "123 King St W", payee_city: "Toronto", payee_state: "ON", payee_zip: "M5H 2N2" }, owner: ["DE", INC] },
  { note: "Canadian address, all in city field", item: { ...BLANK, payee_city: "Vancouver, BC V6B 1A1" }, owner: ["DE", INC] },
  { note: "United Kingdom address", item: { payee_address: "10 Example Road, United Kingdom", payee_city: "London", payee_state: "", payee_zip: "SW1A 1AA" }, owner: ["DE", INC] },
  { note: "Mexican address (NL is not a US state)", item: { payee_address: "Av Ejemplo 100, Mexico", payee_city: "Monterrey", payee_state: "NL", payee_zip: "64000" }, owner: ["DE", INC] },
  { note: "typo: Califronia", item: { payee_address: "900 Lantern Way", payee_city: "Oakland", payee_state: "Califronia", payee_zip: "" }, owner: ["CA", ADDR] },
  { note: "typo: Tennesee", item: { payee_address: "310 Kiln Road", payee_city: "Nashville", payee_state: "Tennesee", payee_zip: "" }, owner: ["TN", ADDR] },
  { note: "typo: Washinton", item: { payee_address: "75 Jetty Lane", payee_city: "Seattle", payee_state: "Washinton", payee_zip: "" }, owner: ["WA", ADDR] },
  { note: "mismatch: Dallas, CA (state field wins over city and ZIP)", item: { payee_address: "40 Gantry Street", payee_city: "Dallas", payee_state: "CA", payee_zip: "75201" }, owner: ["CA", ADDR] },
  { note: "mismatch: Los Angeles, TX (state field wins over ZIP)", item: { payee_address: "41 Gantry Street", payee_city: "Los Angeles", payee_state: "TX", payee_zip: "90012" }, owner: ["TX", ADDR] },
  { note: "lower-case state code", item: { payee_address: "9 Spindle Drive", payee_city: "Dallas", payee_state: "tx", payee_zip: "" }, owner: ["TX", ADDR] },
  { note: "state variant: Calif", item: { payee_address: "9 Spindle Drive", payee_city: "Fresno", payee_state: "Calif", payee_zip: "" }, owner: ["CA", ADDR] },
  { note: "full state name, ZIP from another state", item: { payee_address: "2 Mortise Avenue", payee_city: "Plano", payee_state: "Texas", payee_zip: "10001" }, owner: ["TX", ADDR] },
  { note: "completely empty address", item: { ...BLANK }, owner: ["DE", INC] },
  { note: "whitespace-only address fields", item: { payee_address: "  ", payee_city: " ", payee_state: "  ", payee_zip: "   " }, owner: ["DE", INC] },
  { note: "city only (a city does not determine a state)", item: { ...BLANK, payee_city: "Boston" }, owner: ["DE", INC] },
  { note: "N/A placeholders", item: { payee_address: "N/A", payee_city: "N/A", payee_state: "N/A", payee_zip: "N/A" }, owner: ["DE", INC] },
  { note: "state only in a comma-separated street line", item: { ...BLANK, payee_address: "1 Example Plaza, Seattle, WA" }, owner: ["WA", ADDR] },
  { note: "invalid state code falls back to ZIP", item: { payee_address: "6 Ledger Court", payee_city: "Chicago", payee_state: "XX", payee_zip: "60601" }, owner: ["IL", ADDR] },
  { note: "full state name Delaware", item: { payee_address: "3 Kiln Road", payee_city: "Newark", payee_state: "Delaware", payee_zip: "" }, owner: ["DE", ADDR] },
  { note: "generic check with refund memo is a customer credit", item: { kind: "check", memo: "Refund of overpayment - order 8841", payee_address: "70 Foundry Lane", payee_city: "Oakland", payee_state: "CA", payee_zip: "94601" }, owner: ["CA", ADDR], expected: { property_type: "customer_credit" } },
  { note: "generic check with payroll memo", item: { kind: "check", memo: "Payroll 10/15 - net pay", payee_address: "71 Foundry Lane", payee_city: "Austin", payee_state: "TX", payee_zip: "78702" }, owner: ["TX", ADDR], expected: { property_type: "payroll_check" } },
  { note: "generic credit with unapplied-cash memo", item: { kind: "credit", memo: "Unapplied payment from customer - on account", payee_address: "72 Foundry Lane", payee_city: "Tampa", payee_state: "FL", payee_zip: "33601" }, owner: ["FL", ADDR], expected: { property_type: "unapplied_cash" } },
  { note: "generic credit memo for returned goods", item: { kind: "credit", memo: "Credit memo CM-2201 returned goods", payee_address: "73 Foundry Lane", payee_city: "Peoria", payee_state: "IL", payee_zip: "61601" }, owner: ["IL", ADDR], expected: { property_type: "customer_credit" } },
  { note: "generic check with final-wages memo", item: { kind: "check", memo: "Final wages - terminated employee", payee_address: "74 Foundry Lane", payee_city: "Albany", payee_state: "NY", payee_zip: "12201" }, owner: ["NY", ADDR], expected: { property_type: "payroll_check" } },
];

export function buildAdversarialCases(): EvalCaseFixture[] {
  return ADVERSARIAL_SPECS.map((spec, i): EvalCaseFixture => {
    const n = i + 1;
    const kind = spec.item.kind ?? "vendor_check";
    const item: EvalItem = {
      kind,
      number: `ADV-${String(1000 + n)}`,
      payee_name: `Adversarial Case ${String(n).padStart(2, "0")} Supply (SYNTHETIC)`,
      payee_address: "",
      payee_city: "",
      payee_state: "",
      payee_zip: "",
      amount_cents: 10_000 + n * 1375,
      issue_date: "2025-03-14",
      memo: "Invoice INV-1001",
      cleared_date: null,
      ...spec.item,
    };
    const defaultType =
      kind === "check" || kind === "credit" ? "vendor_check" : kind;
    return {
      id: `adv-${String(n).padStart(2, "0")}`,
      slice: "adversarial",
      item,
      expected: {
        property_type: defaultType,
        owner_state: spec.owner[0],
        owner_state_basis: spec.owner[1],
        is_stale: true,
        ...spec.expected,
      },
    };
  });
}
