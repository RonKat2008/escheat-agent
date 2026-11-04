import { describe, expect, it } from "vitest";
import type { LinkStatus, ProofLink } from "@/lib/audit/proof-chain";
import { chainCounts, chainNodes, chainSrRows, chainSummary, DRAW_STAGGER_MS, railPath } from "./chain-model";

const mk = (status: LinkStatus, over: Partial<ProofLink> = {}): ProofLink => ({
  kind: "ledger",
  label: "Ledger record",
  status,
  evidence: "Evidence.",
  detail: [],
  sources: [],
  unverified: false,
  fix: status === "missing" ? { href: "/items?item=x", label: "Review the item" } : null,
  ...over,
});

describe("chain-model", () => {
  it("maps statuses to the palette: proven blue, missing pink, not yet due dim, not required muted", () => {
    const nodes = chainNodes([mk("proven"), mk("missing"), mk("not_yet_due"), mk("not_required")]);
    expect(nodes.map((n) => n.tone)).toEqual(["blue", "pink", "dim", "muted"]);
    expect(nodes.map((n) => n.rail.stroke)).toEqual(["var(--color-blue-500)", "var(--color-pink-500)", "var(--color-fg-4)", "var(--color-line-strong)"]);
    expect(nodes.map((n) => n.rail.dash)).toEqual([undefined, undefined, "5 5", "1.5 4"]);
    expect(nodes.map((n) => n.glow)).toEqual([true, true, false, false]);
  });

  it("never uses a green or literal color", () => {
    for (const n of chainNodes([mk("proven"), mk("missing"), mk("not_yet_due"), mk("not_required")])) {
      expect(n.rail.stroke.startsWith("var(--color-")).toBe(true);
      expect(n.rail.stroke).not.toMatch(/green/);
    }
  });

  it("staggers the draw in order, and draws instantly when not animating", () => {
    const links = [mk("proven"), mk("proven"), mk("missing")];
    expect(chainNodes(links).map((n) => n.delayMs)).toEqual([0, DRAW_STAGGER_MS, 2 * DRAW_STAGGER_MS]);
    expect(chainNodes(links, { animate: false }).map((n) => n.delayMs)).toEqual([0, 0, 0]);
  });

  it("joins the rail across columns: first starts at centre, last ends at centre", () => {
    expect(railPath(0, 9)).toBe("M50 12 H100");
    expect(railPath(4, 9)).toBe("M0 12 H100");
    expect(railPath(8, 9)).toBe("M0 12 H50");
    expect(railPath(0, 1)).toBe("M50 12 H50");
  });

  it("an unverified rule reads 'Unverified', and its aria label names the fix", () => {
    const [n] = chainNodes([mk("missing", { kind: "rule", label: "Rule version + source", unverified: true, fix: { href: "/rules?state=DE", label: "Verify DE rules" } })]);
    expect(n!.statusText).toBe("Unverified");
    expect(n!.ariaLabel).toContain("unverified rule value");
    expect(n!.ariaLabel).toContain("fix: Verify DE rules");
    expect(n!.ordinal).toBe("01");
  });

  it("counts, summarises and tabulates for screen readers", () => {
    const links = [mk("proven"), mk("missing"), mk("missing"), mk("not_yet_due")];
    expect(chainCounts(links)).toEqual({ proven: 1, missing: 2, notYetDue: 1, notRequired: 0 });
    expect(chainSummary(links)).toBe("1 proven, 2 missing (need a person), 1 not yet due");
    expect(chainSummary([])).toBe("No links");
    const rows = chainSrRows(links);
    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual(["2. Ledger record", "Missing", "Evidence.", "Review the item (/items?item=x)"]);
  });
});
