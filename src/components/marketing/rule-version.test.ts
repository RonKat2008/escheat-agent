import { describe, expect, it } from "vitest";
import { ruleVersionLabel } from "./rule-version";

describe("ruleVersionLabel", () => {
  it("labels a plain version", () => {
    expect(ruleVersionLabel("2026.10.1")).toBe("rules v2026.10.1");
  });
  it("labels a draft", () => {
    expect(ruleVersionLabel("2026.10.1-draft")).toBe("rules v2026.10.1 · draft");
  });
  it("labels an approved draft with the approval date, never a count", () => {
    expect(ruleVersionLabel("2026.10.1-draft+appr.20261103T200207")).toBe("rules v2026.10.1 · draft · approved Nov 3");
  });
  it("labels an approved plain version", () => {
    expect(ruleVersionLabel("2026.10.1+appr.20260105T010101")).toBe("rules v2026.10.1 · approved Jan 5");
  });
  it("falls back to the raw string for unknown shapes", () => {
    expect(ruleVersionLabel("weird version")).toBe("rules vweird version");
  });
});

describe("ruleVersionLabel with a state", () => {
  it("prefixes the state code", () => {
    expect(ruleVersionLabel("2026.10.1-draft+appr.20261103T200207", "TX")).toBe("TX rules v2026.10.1 · draft · approved Nov 3");
  });
  it("never leaks the raw approval stamp", () => {
    expect(ruleVersionLabel("2026.10.1-draft+appr.20261103T200207", "TX")).not.toMatch(/appr\.|T2002/);
  });
});
