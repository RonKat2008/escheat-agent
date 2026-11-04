import { describe, expect, it } from "vitest";
import type { LinkStatus, ProofLink } from "./proof-chain";
import { itemReadiness, readiness } from "./score";

const chain = (...statuses: LinkStatus[]): ProofLink[] =>
  statuses.map((status) => ({ kind: "ledger", label: "x", status, evidence: "", detail: [], sources: [], unverified: false, fix: null }));

describe("readiness", () => {
  it("excludes not_required from the denominator", () => {
    const r = readiness([chain("proven", "proven", "not_required", "not_required")]);
    expect(r).toMatchObject({ proven: 2, required: 2, notRequired: 2, pct: 100 });
  });

  it("counts missing links as unproven and leaves not-yet-due links out of the denominator", () => {
    const r = readiness([chain("proven", "missing", "not_yet_due", "not_required")]);
    expect(r).toMatchObject({ proven: 1, missing: 1, notYetDue: 1, required: 2, pct: 50 });
  });

  it("is null when every required link is still in the future", () => {
    expect(readiness([chain("not_yet_due", "not_yet_due")]).pct).toBeNull();
  });

  it("never rounds a short chain up to 100", () => {
    expect(readiness([chain(...Array<LinkStatus>(199).fill("proven"), "missing")]).pct).toBe(99);
  });

  it("sums across items, and is null when nothing is required", () => {
    expect(readiness([chain("proven"), chain("missing")]).pct).toBe(50);
    expect(readiness([]).pct).toBeNull();
    expect(readiness([chain("not_required")]).pct).toBeNull();
  });

  it("counts a state-wide rules gap once however many items carry it, as one unproven link", () => {
    const items = Array.from({ length: 10 }, () => chain("proven", "proven", "rules_gap"));
    const r = readiness(items);
    expect(r).toMatchObject({ proven: 20, missing: 0, rulesGaps: 1, required: 21, pct: 95 });
    // Not once per item: ten items would have scored 20 of 30.
    expect(r.pct).not.toBe(66);
  });

  it("keeps real missing proofs separate from the rules gap", () => {
    const r = readiness([chain("proven", "missing", "rules_gap"), chain("proven", "rules_gap")]);
    expect(r).toMatchObject({ proven: 2, missing: 1, rulesGaps: 1, required: 4, pct: 50 });
  });

  it("no gap means rulesGaps is 0", () => {
    expect(readiness([chain("proven")]).rulesGaps).toBe(0);
  });
});

describe("itemReadiness (R9-04)", () => {
  it("scores an item on the links it owns; the rules gap is a note, not a denominator entry", () => {
    const r = itemReadiness(chain("proven", "proven", "proven", "rules_gap", "not_yet_due"));
    expect(r).toMatchObject({ proven: 3, required: 3, rulesGaps: 0, pct: 100, rulesGapNote: true });
  });

  it("has no note when the item has no rules gap", () => {
    expect(itemReadiness(chain("proven", "missing")).rulesGapNote).toBe(false);
  });

  it("item denominators plus the single state-wide gap reconcile with the sample", () => {
    const items = Array.from({ length: 10 }, () => chain("proven", "proven", "proven", "rules_gap"));
    const sample = readiness(items);
    const sum = items.reduce((n, c) => n + itemReadiness(c).required, 0);
    expect(sum + sample.rulesGaps).toBe(sample.required);
    expect(sample.pct).toBe(96);
  });
});
