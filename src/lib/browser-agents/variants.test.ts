import { describe, expect, it } from "vitest";
import { selectMatches } from "./recovery";
import { buildNameVariants, companyNameVariants, MATCH_THRESHOLD, scoreNameMatch } from "./variants";

describe("companyNameVariants", () => {
  it("expands punctuation, case and legal-suffix variants without duplicates", () => {
    const v = companyNameVariants("Northwind Fixtures, Inc.");
    expect(v[0]).toBe("Northwind Fixtures, Inc.");
    const lower = v.map((x) => x.toLowerCase());
    expect(lower).toContain("northwind fixtures inc");
    expect(lower).toContain("northwind fixtures");
    expect(new Set(v.map((x) => x.toLowerCase())).size).toBe(v.length);
  });

  it("returns nothing for a blank name", () => {
    expect(companyNameVariants("   ")).toEqual([]);
  });
});

describe("buildNameVariants", () => {
  it("adds payee aliases that normalize to the company, and ignores unrelated payees", () => {
    const v = buildNameVariants("Northwind Fixtures, Inc.", [
      { canonicalName: "Bayline Electric", aliases: ["Bay Line Electric"] },
      { canonicalName: "Northwind Fixtures LLC", aliases: ["NorthWind Fixtures Incorporated"] },
    ]);
    expect(v).toContain("Northwind Fixtures LLC");
    expect(v.some((x) => /bayline/i.test(x))).toBe(false);
  });
});

describe("scoreNameMatch / selectMatches", () => {
  it("scores the same company 100 and drops near-miss decoys below the threshold", () => {
    expect(scoreNameMatch("Northwind Fixtures, Inc.", "NORTHWIND FIXTURES INC").confidence).toBe(100);
    for (const decoy of ["NORTHWIND FOODS LLC", "NORTHWEST FIXTURES INC", "NORTH WIND FIXTURE SUPPLY"]) {
      expect(scoreNameMatch("Northwind Fixtures, Inc.", decoy).confidence).toBeLessThan(MATCH_THRESHOLD);
    }
  });

  it("keeps only rows at or above the threshold, best variant per property", () => {
    const rows = [
      { ownerName: "NORTHWIND FIXTURES INC", amountCents: 118_000, propertyId: "P1", reportedBy: "X" },
      { ownerName: "NORTHWEST FIXTURES INC", amountCents: 9_500, propertyId: "P2", reportedBy: "Y" },
    ];
    const out = selectMatches(rows, ["Northwind Fixtures, Inc.", "NORTHWIND FIXTURES"], "TX");
    expect(out.map((c) => c.row.propertyId)).toEqual(["P1"]);
    expect(out[0]!.confidence).toBe(100);
  });
});
