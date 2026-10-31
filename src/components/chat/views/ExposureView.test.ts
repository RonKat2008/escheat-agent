import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Exposure } from "@/lib/queries/schemas";
import { ExposureView } from "./ExposureView";

const row = (state: string, cents: number, count: number) => ({ state, cents, formatted: `$${(cents / 100).toFixed(2)}`, count, anyUnverified: true });
const exposure: Exposure = {
  asOf: "2026-11-01",
  totalCents: 6191500,
  total: { cents: 6191500, formatted: "$61,915.00" } as Exposure["total"],
  itemCount: 47,
  anyUnverified: true,
  byState: [row("CA", 2841000, 21), row("TX", 1986200, 15), row("DE", 1364300, 11)],
  byStatus: [],
  byPropertyType: [],
};

const html = () => renderToStaticMarkup(createElement(ExposureView, { exposure, state: null }));

/**
 * Regression: the ring used to be drawn by an animated recharts <Pie>, which paints no sectors until the
 * animation advances (about 500ms after the card mounts, and it ignored prefers-reduced-motion), so the
 * left column showed only the "3 states" label. The first render must already hold the ring.
 */
describe("ExposureView ring", () => {
  it("paints a non-zero-size svg with one arc per state in the very first render", () => {
    const out = html();
    const svg = /<svg[^>]*data-testid="exposure-ring"[^>]*>/.exec(out)?.[0] ?? "";
    expect(svg).toMatch(/width="104"/);
    expect(svg).toMatch(/height="104"/);
    expect([...out.matchAll(/<circle[^>]*data-state="(CA|TX|DE)"/g)]).toHaveLength(3);
    expect(out).toContain("3 states");
  });

  it("sizes arcs by share of the total and draws every arc with a visible length", () => {
    const lengths = [...html().matchAll(/<circle[^>]*stroke-dasharray="([\d.]+) /g)].map((m) => Number(m[1]));
    expect(lengths).toHaveLength(3);
    for (const l of lengths) expect(l).toBeGreaterThan(10);
    const [ca = 0, tx = 0, de = 0] = lengths;
    expect(ca).toBeGreaterThan(tx);
    expect(tx).toBeGreaterThan(de);
  });

  it("uses only palette strokes (blue tints and neutral white), never a new hue", () => {
    const strokes = [...html().matchAll(/<circle[^>]*stroke="([^"]+)"/g)].map((m) => m[1]);
    expect(strokes).toHaveLength(3);
    for (const f of strokes) expect(f).toMatch(/^(var\(--chat-blue-(500|300)\)|rgb\(255 255 255 \/ [\d.]+\))$/);
  });
});
