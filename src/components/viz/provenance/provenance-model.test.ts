import { describe, expect, it } from "vitest";
import { chainThrough, domainOf, layoutProvenance, type ProvenanceInput } from "./provenance-model";

const base: ProvenanceInput = {
  state: "tx",
  rulePath: "propertyTypes.vendor_check.dormancyYears",
  value: "3 years",
  sources: [
    { url: "https://statutes.capitol.texas.gov/Docs/PR/htm/PR.72.htm", title: "Tex. Prop. Code ch. 72", quote: "three years" },
    { url: "https://www.comptroller.texas.gov/programs/unclaimed/", title: "", quote: "" },
  ],
  verified: false,
};

describe("layoutProvenance", () => {
  it("lays out value → path → sources → verification left to right", () => {
    const l = layoutProvenance(base);
    expect(l.columns.map((c) => c.column)).toEqual(["value", "path", "source", "verification"]);
    const xs = l.columns.map((c) => c.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    const last = l.columns.at(-1)!;
    expect(l.width).toBe(last.x + last.width);
    const path = l.nodes.find((n) => n.id === "path")!;
    expect(path.label).toBe("rules/TX.json");
    expect(path.sublabel).toBe(base.rulePath);
  });

  it("makes one node per http source, labeled by title or domain, and stacks them without overlap", () => {
    const l = layoutProvenance(base, { nodeHeight: 50, rowGap: 10 });
    const src = l.nodes.filter((n) => n.column === "source");
    expect(src.map((s) => s.label)).toEqual(["Tex. Prop. Code ch. 72", "comptroller.texas.gov"]);
    expect(src[1]!.y - src[0]!.y).toBe(60);
    expect(src.every((s) => s.href?.startsWith("https://"))).toBe(true);
    // the single-node columns are centered on the tallest column
    const value = l.nodes.find((n) => n.id === "value")!;
    expect(value.y + value.height / 2).toBeCloseTo((src[0]!.y + src[1]!.y + src[1]!.height) / 2);
    expect(l.height).toBe(24 + 50 * 2 + 10);
  });

  it("links every source to the path and to the verification node", () => {
    const l = layoutProvenance(base);
    expect(l.links.map((k) => k.id)).toEqual([
      "value->path",
      "path->source-0",
      "path->source-1",
      "source-0->verification",
      "source-1->verification",
    ]);
    for (const k of l.links) expect(k.d).toMatch(/^M[\d.]+,[\d.]+C/);
    // unverified: the links into verification are dashed, the backbone is solid
    expect(l.links.find((k) => k.id === "value->path")!.dashed).toBe(false);
    expect(l.links.filter((k) => k.to === "verification").every((k) => k.dashed)).toBe(true);
  });

  it("draws an unknown value hollow with dashed links, says UNVERIFIED, and never invents a source", () => {
    const l = layoutProvenance({ ...base, value: null, sources: [{ url: "javascript:alert(1)", title: "x" }] });
    const value = l.nodes.find((n) => n.id === "value")!;
    expect(value).toMatchObject({ label: "Unknown", hollow: true });
    expect(l.nodes.find((n) => n.id === "source-none")).toMatchObject({ label: "No source cited", hollow: true, href: null });
    expect(l.nodes.find((n) => n.id === "verification")).toMatchObject({ label: "UNVERIFIED", hollow: true });
    expect(l.links.every((k) => k.dashed)).toBe(true);
  });

  it("names the approver and date when verified", () => {
    const l = layoutProvenance({ ...base, verified: true, verifiedBy: "Dana", verifiedAt: "2026-10-30T12:00:00.000Z" });
    expect(l.nodes.find((n) => n.id === "verification")).toMatchObject({ label: "Verified by Dana", sublabel: "on Oct 30, 2026", hollow: false });
    expect(l.links.some((k) => k.dashed)).toBe(false);
  });

  it("adds a derivation column on the left when steps are given", () => {
    const l = layoutProvenance({ ...base, derivation: ["Issued 2022-03-01", "", "Dormant after 3 years"] });
    expect(l.columns[0]!.column).toBe("derivation");
    expect(l.nodes.filter((n) => n.column === "derivation")).toHaveLength(2);
    expect(l.links.filter((k) => k.to === "value")).toHaveLength(2);
  });
});

describe("chainThrough", () => {
  it("highlights only the chain through one source", () => {
    const l = layoutProvenance(base);
    const c = chainThrough(l, "source-1");
    expect([...c.nodes].sort()).toEqual(["path", "source-1", "value", "verification"]);
    expect(c.links.has("path->source-0")).toBe(false);
    expect(c.links.has("source-1->verification")).toBe(true);
  });
});

describe("domainOf", () => {
  it("strips www and survives bad urls", () => {
    expect(domainOf("https://www.example.gov/x")).toBe("example.gov");
    expect(domainOf("not a url")).toBe("not a url");
  });
});
