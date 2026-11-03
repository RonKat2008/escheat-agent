import { describe, expect, it } from "vitest";
import { ownerRailView } from "./view";

const base = { contactedOn: "2026-11-01", asOf: "2026-11-01", respondBy: "2027-05-02", respondByUnverified: false, ownerState: "CA" };

describe("owner rail copy (R4-13: owner-facing only)", () => {
  it("never shows compliance wording; an unchecked date reads '(estimated)'", () => {
    const v = ownerRailView({ ...base, respondByUnverified: true });
    expect(v.respondLabel).toBe("Respond by (estimated)");
    expect(v.help).toContain("(estimated)");
    expect(JSON.stringify(v)).not.toMatch(/unverified|rule|UNVERIFIED/i);
  });

  it("a checked date has no qualifier", () => {
    expect(ownerRailView(base).respondLabel).toBe("Respond by");
  });

  it("the 'we wrote to you' date never comes after the holder's today", () => {
    expect(ownerRailView({ ...base, contactedOn: "2026-11-03", asOf: "2026-11-01" }).wroteOn).toBe("2026-11-01");
    expect(ownerRailView({ ...base, contactedOn: "2026-10-20" }).wroteOn).toBe("2026-10-20");
    expect(ownerRailView({ ...base, contactedOn: null }).wroteOn).toBeNull();
  });

  it("an unknown deadline is said plainly, never guessed", () => {
    expect(ownerRailView({ ...base, respondBy: null }).help).toMatch(/not confirmed yet/);
  });
});
