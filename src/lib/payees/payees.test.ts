import { describe, expect, it, vi } from "vitest";
import { addressAgreement } from "./address";
import { clusterPayees, clusterPayeesSync, pairScore, type PayeeInput } from "./cluster";
import { normalizeName } from "./normalize";
import { jaroWinkler, tokenJaccard } from "./similarity";

const p = (id: string, name: string, extra: Partial<PayeeInput> = {}): PayeeInput => ({ id, name, ...extra });

describe("normalizeName", () => {
  it("lowercases, strips punctuation and legal suffixes", () => {
    expect(normalizeName("Bayline Electric, LLC")).toBe("bayline electric");
    expect(normalizeName("BAYLINE ELECTRIC INC.")).toBe("bayline electric");
    expect(normalizeName("Bayline Electric Co.")).toBe("bayline electric");
    expect(normalizeName("Smith Bros Corp")).toBe("smith brothers");
  });
  it("treats & and 'and' the same", () => {
    expect(normalizeName("Smith & Sons")).toBe(normalizeName("Smith and Sons"));
  });
  it("expands abbreviations only from the explicit table", () => {
    expect(normalizeName("Bayline Elec")).toBe("bayline electric");
    expect(normalizeName("Zorbo Qux")).toBe("zorbo qux");
  });
  it("keeps names that are only a suffix and drops a leading 'the'", () => {
    expect(normalizeName("Co")).toBe("co");
    expect(normalizeName("The Acme Co")).toBe("acme");
    expect(normalizeName("O'Brien's Inc")).toBe("obriens");
  });
});

describe("similarity", () => {
  it("jaro-winkler basics", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 2);
    expect(jaroWinkler("abc", "abc")).toBe(1);
    expect(jaroWinkler("abc", "xyz")).toBe(0);
    expect(jaroWinkler("", "a")).toBe(0);
  });
  it("token jaccard", () => {
    expect(tokenJaccard(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3);
    expect(tokenJaccard([], [])).toBe(1);
  });
});

describe("addressAgreement", () => {
  it("matches abbreviation variants", () => {
    expect(addressAgreement({ addressLine: "12 Pier Rd" }, { addressLine: "12 Pier Road" })).toBe("match");
  });
  it("conflicts on different streets and zips", () => {
    expect(
      addressAgreement({ addressLine: "12 Pier Rd", zip: "94607" }, { addressLine: "900 Main St", zip: "75001" }),
    ).toBe("conflict");
  });
  it("is unknown when data is missing", () => {
    expect(addressAgreement({}, { addressLine: "1 A St" })).toBe("unknown");
    expect(addressAgreement({ state: "CA" }, { state: "CA" })).toBe("unknown");
  });
  it("conflicts on different states or zips when streets are absent", () => {
    expect(addressAgreement({ state: "CA" }, { state: "TX" })).toBe("conflict");
    expect(addressAgreement({ zip: "94607-1234" }, { zip: "94607" })).toBe("match");
  });
});

describe("clusterPayeesSync", () => {
  const bayline = [
    p("1", "Bayline Electric", { addressLine: "12 Pier Rd", city: "Oakland", state: "CA", zip: "94607" }),
    p("2", "BAYLINE ELECTRIC INC", { addressLine: "12 Pier Road", state: "CA", zip: "94607" }),
    p("3", "Bayline Elec., LLC", { state: "CA" }),
    p("4", "Bayline Electric Co"),
  ];

  it("merges Bayline variants into one cluster", () => {
    const r = clusterPayeesSync(bayline);
    expect(r.clusters).toHaveLength(1);
    const c = r.clusters[0]!;
    expect(c.members.map((m) => m.id)).toEqual(["1", "2", "3", "4"]);
    expect(c.canonicalName).toBe("Bayline Electric");
    expect(c.aliases.sort()).toEqual(["BAYLINE ELECTRIC INC", "Bayline Elec., LLC", "Bayline Electric Co"].sort());
    expect(c.basis).toBe("exact");
    expect(r.ambiguous).toEqual([]);
  });

  it("merges near-identical spellings by rule", () => {
    const r = clusterPayeesSync([p("1", "Bayline Electric"), p("2", "Baylyne Electric")]);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]!.basis).toBe("rule");
    expect(r.clusters[0]!.confidence).toBeGreaterThanOrEqual(95);
  });

  it("flags ABC Supply vs ABD Supply as ambiguous, not merged", () => {
    const r = clusterPayeesSync([p("1", "ABC Supply"), p("2", "ABD Supply")]);
    expect(r.clusters).toHaveLength(2);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0]!.score).toBeGreaterThanOrEqual(0.8);
    expect(r.ambiguous[0]!.score).toBeLessThan(0.95);
  });

  it("keeps clearly different names apart without reporting them", () => {
    const r = clusterPayeesSync([p("1", "Acme Plumbing"), p("2", "Zenith Roofing")]);
    expect(r.clusters).toHaveLength(2);
    expect(r.ambiguous).toEqual([]);
  });

  it("different addresses lower the score; same name + conflicting address becomes ambiguous", () => {
    const same = p("1", "Smith Plumbing", { addressLine: "1 Oak St", zip: "94607", state: "CA" });
    const sameAddr = p("2", "Smith Plumbing Inc", { addressLine: "1 Oak Street", zip: "94607", state: "CA" });
    const other = p("3", "Smith Plumbing LLC", { addressLine: "900 Elm Ave", zip: "75001", state: "TX" });
    expect(pairScore(same, sameAddr)).toBeGreaterThan(pairScore(same, other));
    expect(pairScore(same, other)).toBeLessThan(0.95);
    const r = clusterPayeesSync([same, sameAddr, other]);
    expect(r.clusters.map((c) => c.members.map((m) => m.id))).toEqual([["1", "2"], ["3"]]);
    expect(r.ambiguous).toHaveLength(1);
  });

  it("address agreement can lift a borderline pair over the merge threshold", () => {
    const a = p("1", "Pacific Coast Supply", { addressLine: "5 Dock Ln", zip: "90001" });
    const b = p("2", "Pacific Cost Supply", { addressLine: "5 Dock Lane", zip: "90001" });
    const bNoAddr = p("3", "Pacific Cost Supply");
    expect(pairScore(a, b)).toBeGreaterThan(pairScore(a, bNoAddr));
  });

  it("never auto-merges names that differ only by a number", () => {
    const r = clusterPayeesSync([p("1", "Plant 1 Services"), p("2", "Plant 2 Services")]);
    expect(r.clusters).toHaveLength(2);
    expect(r.ambiguous).toEqual([]);
  });

  it("picks the most common spelling as canonical", () => {
    const r = clusterPayeesSync([p("1", "ACME TOOL"), p("2", "Acme Tool"), p("3", "Acme Tool")]);
    expect(r.clusters[0]!.canonicalName).toBe("Acme Tool");
  });

  it("handles empty input and singletons", () => {
    expect(clusterPayeesSync([]).clusters).toEqual([]);
    const r = clusterPayeesSync([p("1", "Solo LLC")]);
    expect(r.clusters[0]).toMatchObject({ basis: "exact", confidence: 100, aliases: [] });
  });
});

describe("clusterPayees with injected resolver", () => {
  it("is called only for ambiguous pairs", async () => {
    const resolver = vi.fn(async () => ({ same: false, confidence: 0.9, rationale: "different" }));
    const r = await clusterPayees(
      [p("1", "Bayline Electric"), p("2", "Bayline Electric Inc"), p("3", "ABC Supply"), p("4", "ABD Supply"), p("5", "Zenith")],
      { resolver },
    );
    expect(resolver).toHaveBeenCalledTimes(1);
    const arg = (resolver.mock.calls[0] as unknown as [{ a: PayeeInput; b: PayeeInput }])[0];
    expect([arg.a.id, arg.b.id].sort()).toEqual(["3", "4"]);
    expect(r.clusters).toHaveLength(4);
    expect(r.ambiguous).toEqual([]);
    expect(r.resolved[0]).toMatchObject({ same: false, rationale: "different" });
  });

  it("is not called at all when nothing is ambiguous", async () => {
    const resolver = vi.fn();
    await clusterPayees([p("1", "Acme"), p("2", "Acme Inc"), p("3", "Zenith")], { resolver });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("merges with basis 'model' when the resolver confidently says same", async () => {
    const r = await clusterPayees([p("3", "ABC Supply"), p("4", "ABD Supply")], {
      resolver: async () => ({ same: true, confidence: 0.92, rationale: "typo" }),
    });
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]).toMatchObject({ basis: "model", confidence: 92 });
  });

  it("does not merge on a low-confidence 'same'", async () => {
    const r = await clusterPayees([p("3", "ABC Supply"), p("4", "ABD Supply")], {
      resolver: async () => ({ same: true, confidence: 0.5, rationale: "unsure" }),
    });
    expect(r.clusters).toHaveLength(2);
  });

  it("without a resolver, ambiguous pairs are reported and kept separate", async () => {
    const r = await clusterPayees([p("3", "ABC Supply"), p("4", "ABD Supply")]);
    expect(r.clusters).toHaveLength(2);
    expect(r.ambiguous).toHaveLength(1);
  });
});
