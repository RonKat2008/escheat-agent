import { describe, expect, it } from "vitest";
import { tryLoadRules } from "@/lib/rules/load";
import { listRuleValues } from "@/lib/rules/values";
import { showsUnverified } from "./filing-unverified";

describe("R11-08: UNVERIFIED on filing cards", () => {
  it("shows for an unverified rule file even when the cycle has no items", () => {
    expect(showsUnverified({ unverifiedRules: 0, ruleFileUnverified: 12 })).toBe(true);
  });
  it("shows when the cycle relies on an unverified value", () => {
    expect(showsUnverified({ unverifiedRules: 2, ruleFileUnverified: 0 })).toBe(true);
  });
  it("is absent only when nothing is unverified", () => {
    expect(showsUnverified({ unverifiedRules: 0, ruleFileUnverified: 0 })).toBe(false);
  });
  it("the shipped DE rule file is unverified, so its card must carry the badge", () => {
    const rules = tryLoadRules("DE");
    expect(rules).not.toBeNull();
    const n = listRuleValues(rules!.file).filter((v) => !v.rv.verified).length;
    expect(showsUnverified({ unverifiedRules: 0, ruleFileUnverified: n })).toBe(true);
  });
});
