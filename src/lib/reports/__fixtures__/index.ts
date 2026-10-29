/** SYNTHETIC test data for the reports tests. No real people, companies or TINs. */
import type { RuleFile } from "../../../../rules/schema";
import { loadRules } from "../../rules/load";
import { listRuleValues } from "../../rules/values";
import type { BuildNaupaInput, ReportHolder, ReportItem } from "../naupa";

export const HOLDER: ReportHolder = {
  name: "Northwind Fixtures, Inc.",
  city: "Austin",
  state: "TX",
  incorporatedState: "DE",
  incorporationDate: "2011-04-12",
  sicCode: "5719",
  naicsCode: "423220",
  contact: {
    name: "Pat Synthetic",
    address1: "100 Example Way",
    city: "Austin",
    state: "TX",
    zip: "78701",
    phoneAreaCode: "555",
    phone: "5550100",
    email: "pat@example.test",
  },
};

export const item = (over: Partial<ReportItem> & { id: string }): ReportItem => ({
  propertyType: "vendor_check",
  amountCents: 234000,
  lastActivityDate: "2024-08-15",
  ownerName: { last: "Bayline Electric" },
  address1: "55 Harbor St",
  city: "Oakland",
  state: "CA",
  zip: "94607",
  referenceNumber: "10482",
  description: "Uncashed vendor check",
  ...over,
});

export const ITEMS: ReportItem[] = [
  item({ id: "i1" }), // $2,340.00 CK13
  item({ id: "i2", amountCents: 1250, ownerName: { last: "Tiny Parts Co" }, referenceNumber: "10501" }), // under $25
  item({ id: "i3", amountCents: 800, ownerName: { last: "Small Supply LLC" }, referenceNumber: "10502" }), // under $25
  item({ id: "i4", propertyType: "payroll_check", amountCents: 25300, ownerName: { last: "Doe", first: "Jane" }, isBusiness: false, referenceNumber: "P-77" }),
];

export const loadFile = (state: string): RuleFile => loadRules(state).file;

export function buildInput(state: "CA" | "DE" | "TX", stage: string, over: Partial<BuildNaupaInput> = {}): BuildNaupaInput {
  return {
    holder: HOLDER,
    state,
    period: { start: "2025-07-01", end: "2026-06-30" },
    stage,
    items: ITEMS,
    rules: loadFile(state),
    ...over,
  };
}

/** Deep copy of a rule file with every value marked verified (to test the "no UNVERIFIED" path). */
export function allVerified(file: RuleFile): RuleFile {
  const copy = structuredClone(file);
  for (const { rv } of listRuleValues(copy)) rv.verified = true;
  return copy;
}

export function withNullCode(file: RuleFile, pt: "vendor_check" | "payroll_check"): RuleFile {
  const copy = structuredClone(file);
  const rule = copy.propertyTypes[pt];
  if (rule) rule.naupaCode.value = null;
  return copy;
}
