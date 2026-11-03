import { describe, expect, it } from "vitest";
import { buildWhy, defaultWhyKey, type WhyInput } from "./why-model";

const base: WhyInput = {
  key: "report_due",
  label: "Report due",
  date: "2029-10-31",
  status: "ok",
  verified: false,
  legal: true,
  ruleVersion: "TX@2026.1",
  rulePaths: ["propertyTypes.vendor_check.dormancyYears", "reportStages[annual].dueMonthDay"],
  sources: [
    { url: "https://comptroller.texas.gov/a", title: "TX statute", quote: "q1" },
    { url: "https://comptroller.texas.gov/a", title: "dup", quote: "q2" },
    { url: "javascript:alert(1)", title: "bad", quote: "" },
  ],
  derivation: ["Sep 1, 2025 + 3-year dormancy = Sep 1, 2028", "so it moves to the next Oct 31: Oct 31, 2029"],
  roll: null,
  notes: [],
};

describe("buildWhy", () => {
  it("keeps the engine's steps, every rule path and de-duplicated http sources", () => {
    const m = buildWhy(base);
    expect(m.steps).toHaveLength(2);
    expect(m.rules.map((r) => r.path)).toEqual(base.rulePaths);
    expect(m.rules[0]!.version).toBe("TX@2026.1");
    expect(m.sources.map((s) => s.title)).toEqual(["TX statute"]);
    expect(m.layerCount).toBe(5);
  });

  it("marks unverified rule dates, verified ones, and ledger facts that are not rules", () => {
    expect(buildWhy(base).verification).toBe("unverified");
    expect(buildWhy({ ...base, verified: true }).verification).toBe("verified");
    const issued = buildWhy({ ...base, key: "issued", legal: false, rulePaths: [], sources: [], derivation: [] });
    expect(issued.verification).toBe("not_a_rule");
    expect(issued.rules).toEqual([]);
    expect(issued.layerCount).toBe(2);
  });

  it("never invents a date: unknown keeps the engine's note as the reason", () => {
    const m = buildWhy({ ...base, date: null, status: "unknown", derivation: [], notes: ["TX requiredLanguage is UNKNOWN."] });
    expect(m.date).toBeNull();
    expect(m.unknownReason).toBe("TX requiredLanguage is UNKNOWN.");
    expect(buildWhy({ ...base, date: null, status: "unknown", notes: [] }).unknownReason).toMatch(/could not compute/);
  });
});

describe("defaultWhyKey", () => {
  const nodes = [
    { key: "issued", legal: false, derivation: [], date: "2024-01-01" },
    { key: "presumed_abandoned", legal: true, derivation: [], date: null },
    { key: "report_due", legal: true, derivation: ["x"], date: "2029-10-31" },
  ];
  it("prefers the next deadline, then the first legal date with a derivation", () => {
    expect(defaultWhyKey(nodes, "presumed_abandoned")).toBe("presumed_abandoned");
    expect(defaultWhyKey(nodes, undefined)).toBe("report_due");
    expect(defaultWhyKey([], undefined)).toBeNull();
  });
});
