/**
 * TEST FIXTURES ONLY. SYNTHETIC rule data for unit tests; these are NOT real statutes and must never be
 * copied into rules/. State codes "ZZ"/"ZY" are deliberately not real states.
 */
import type { RuleFile, RuleSource, RuleValue } from "../../../../rules/schema";

export const TEST_SOURCE: RuleSource = {
  url: "https://example.test/fixture-statute",
  title: "TEST FIXTURE (not a real source)",
  quote: "synthetic",
  retrieved_at: "2026-01-01",
};

export function rv<T>(value: T | null, verified = true): RuleValue<T> {
  return { value, sources: [TEST_SOURCE], verified };
}

const pt = (dormancyYears: number | null, verified = true) => ({
  naupaCode: rv("TC01", verified),
  dormancyYears: rv(dormancyYears, verified),
  clockStartsFrom: rv("issue_date" as const, verified),
  minAmountCents: rv(0, verified),
  aggregateThresholdCents: rv(5000, verified),
});

/** Single-stage state: as-of cutoff 30 Jun, report due 1 Nov of that year, remit with the report. */
export function simpleFile(over: Partial<RuleFile> = {}): RuleFile {
  return {
    state: "ZZ",
    version: "test-v1",
    researched_at: "2026-01-01",
    researched_by: "fixture",
    propertyTypes: {
      vendor_check: pt(3),
      payroll_check: pt(1),
      customer_credit: pt(3),
      unapplied_cash: pt(3),
    },
    dueDiligence: {
      required: rv(true),
      minAmountCents: rv(5000),
      windowDaysBeforeReport: rv({ min: 60, max: 120 }),
      mailingMethod: rv("first_class"),
      requiredLanguage: rv("TEST"),
    },
    reportStages: [
      {
        name: "annual",
        asOfRule: rv({ type: "fixed_cutoff" as const, month: 6, day: 30 }),
        dueRule: rv({ type: "fixed_date" as const, month: 11, day: 1, yearOffset: 0 }),
        includesRemittance: true,
      },
    ],
    remitRule: rv({ type: "with_report" as const, stage: "annual" }),
    businessDayRollForward: rv<boolean>(true),
    interest: rv({ annualRatePct: 12, basis: "simple" }),
    electronicFormat: null,
    portal: null,
    notes: [],
    ...over,
  };
}

/** CA-like two-stage: notice stage then a report+remit stage 4 months later. Cutoff 30 Jun. */
export function twoStageFile(over: Partial<RuleFile> = {}): RuleFile {
  return simpleFile({
    state: "ZY",
    version: "test-2stage-v1",
    reportStages: [
      {
        name: "notice",
        asOfRule: rv({ type: "fixed_cutoff" as const, month: 6, day: 30 }),
        dueRule: rv({ type: "fixed_date" as const, month: 11, day: 1, yearOffset: 0 }),
        includesRemittance: false,
      },
      {
        name: "report",
        asOfRule: rv({ type: "fixed_cutoff" as const, month: 6, day: 30 }),
        dueRule: rv({ type: "after_stage" as const, stage: "notice", months: 4 }),
        includesRemittance: true,
      },
    ],
    remitRule: rv({ type: "with_report" as const, stage: "report" }),
    ...over,
  });
}
