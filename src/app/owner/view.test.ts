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

  it("R5-13: no deadline drops the respond-by line; never 'Unknown' or compliance wording", () => {
    const v = ownerRailView({ ...base, issueDate: "2024-01-15", respondBy: null });
    expect(v.steps.map((s) => s.key)).toEqual(["issued", "contacted"]);
    expect(v.help).toBe("Please answer below as soon as you can, so we can get this money to you.");
    expect(JSON.stringify(v)).not.toMatch(/unknown|not confirmed|verif|rule/i);
  });

  it("R5-13: every step shown has a real date, in order", () => {
    const v = ownerRailView({ ...base, issueDate: "2024-01-15" });
    expect(v.steps).toEqual([
      { key: "issued", label: "Payment issued", date: "2024-01-15" },
      { key: "contacted", label: "We wrote to you", date: "2026-11-01" },
      { key: "respond_by", label: "Respond by", date: "2027-05-02" },
    ]);
    expect(ownerRailView({ ...base, contactedOn: null, respondBy: null }).steps).toEqual([]);
  });
});
