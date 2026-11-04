import { describe, expect, it } from "vitest";
import type { LinkStatus, ProofLink } from "./proof-chain";
import { readiness } from "./score";

const chain = (...statuses: LinkStatus[]): ProofLink[] =>
  statuses.map((status) => ({ kind: "ledger", label: "x", status, evidence: "", detail: [], sources: [], unverified: false, fix: null }));

describe("readiness", () => {
  it("excludes not_required from the denominator", () => {
    const r = readiness([chain("proven", "proven", "not_required", "not_required")]);
    expect(r).toMatchObject({ proven: 2, required: 2, notRequired: 2, pct: 100 });
  });

  it("counts missing and not-yet-due links as unproven", () => {
    const r = readiness([chain("proven", "missing", "not_yet_due", "not_required")]);
    expect(r).toMatchObject({ proven: 1, missing: 1, notYetDue: 1, required: 3, pct: 33 });
  });

  it("never rounds a short chain up to 100", () => {
    expect(readiness([chain(...Array<LinkStatus>(199).fill("proven"), "missing")]).pct).toBe(99);
  });

  it("sums across items, and is null when nothing is required", () => {
    expect(readiness([chain("proven"), chain("missing")]).pct).toBe(50);
    expect(readiness([]).pct).toBeNull();
    expect(readiness([chain("not_required")]).pct).toBeNull();
  });
});
