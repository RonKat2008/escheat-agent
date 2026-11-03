/**
 * Precomputes the Money Map geography (DESIGN-V3 §3.2): the national outline plus all 50 state paths, projected with
 * d3-geo geoAlbersUsa onto a 960x600 plane and simplified (Douglas-Peucker) to 0.5px. Writes
 * src/components/viz/money-map/us-paths.ts. Dev-time only: d3-geo, topojson-client and us-atlas are devDependencies,
 * and the output is imported by server components only, so none of this ships as client JS.
 *
 *   pnpm exec tsx scripts/gen-us-paths.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";

const W = 960;
const H = 600;
const TOLERANCE = 0.5;
const OUT = join(process.cwd(), "src/components/viz/money-map/us-paths.ts");

/** FIPS code to postal code and name, 50 states + DC (territories are dropped). */
const STATES: Record<string, [string, string]> = {
  "01": ["AL", "Alabama"], "02": ["AK", "Alaska"], "04": ["AZ", "Arizona"], "05": ["AR", "Arkansas"], "06": ["CA", "California"],
  "08": ["CO", "Colorado"], "09": ["CT", "Connecticut"], "10": ["DE", "Delaware"], "11": ["DC", "District of Columbia"],
  "12": ["FL", "Florida"], "13": ["GA", "Georgia"], "15": ["HI", "Hawaii"], "16": ["ID", "Idaho"], "17": ["IL", "Illinois"],
  "18": ["IN", "Indiana"], "19": ["IA", "Iowa"], "20": ["KS", "Kansas"], "21": ["KY", "Kentucky"], "22": ["LA", "Louisiana"],
  "23": ["ME", "Maine"], "24": ["MD", "Maryland"], "25": ["MA", "Massachusetts"], "26": ["MI", "Michigan"], "27": ["MN", "Minnesota"],
  "28": ["MS", "Mississippi"], "29": ["MO", "Missouri"], "30": ["MT", "Montana"], "31": ["NE", "Nebraska"], "32": ["NV", "Nevada"],
  "33": ["NH", "New Hampshire"], "34": ["NJ", "New Jersey"], "35": ["NM", "New Mexico"], "36": ["NY", "New York"],
  "37": ["NC", "North Carolina"], "38": ["ND", "North Dakota"], "39": ["OH", "Ohio"], "40": ["OK", "Oklahoma"], "41": ["OR", "Oregon"],
  "42": ["PA", "Pennsylvania"], "44": ["RI", "Rhode Island"], "45": ["SC", "South Carolina"], "46": ["SD", "South Dakota"],
  "47": ["TN", "Tennessee"], "48": ["TX", "Texas"], "49": ["UT", "Utah"], "50": ["VT", "Vermont"], "51": ["VA", "Virginia"],
  "53": ["WA", "Washington"], "54": ["WV", "West Virginia"], "55": ["WI", "Wisconsin"], "56": ["WY", "Wyoming"],
};

type Pt = [number, number];

/** Perpendicular distance from p to the segment a-b. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker, iterative. */
function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let max = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(pts[i]!, pts[s]!, pts[e]!);
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (idx >= 0 && max > tol) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** A d3-geo path context that collects rings so they can be simplified before serializing. */
class RingCollector {
  rings: Pt[][] = [];
  private cur: Pt[] | null = null;
  beginPath() {}
  moveTo(x: number, y: number) {
    this.cur = [[x, y]];
    this.rings.push(this.cur);
  }
  lineTo(x: number, y: number) {
    this.cur?.push([x, y]);
  }
  closePath() {
    this.cur = null;
  }
  arc() {}
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function toPath(rings: Pt[][], closed: boolean): string {
  const out: string[] = [];
  for (const ring of rings) {
    const s = simplify(ring, TOLERANCE);
    if (closed && s.length < 4) continue; // slivers and specks below half a pixel
    if (!closed && s.length < 2) continue;
    out.push(`M${s.map(([x, y]) => `${r1(x)},${r1(y)}`).join("L")}${closed ? "Z" : ""}`);
  }
  return out.join("");
}

function main() {
  const require = createRequire(import.meta.url);
  type Topo = Parameters<typeof feature>[0];
  const topo = JSON.parse(readFileSync(require.resolve("us-atlas/states-10m.json"), "utf8")) as Topo;
  const obj = topo.objects as unknown as Record<"states" | "nation", never>;
  const states = feature(topo, obj.states) as unknown as { features: { id?: string | number }[] };
  const kept = states.features.filter((f) => STATES[String(f.id)]);
  const projection = geoAlbersUsa().fitSize([W, H], { type: "FeatureCollection", features: kept } as never);

  type Geo = Parameters<ReturnType<typeof geoPath>>[0];
  const pathOf = (geo: unknown, closed = true) => {
    const ctx = new RingCollector();
    geoPath(projection, ctx as unknown as CanvasRenderingContext2D)(geo as Geo);
    return toPath(ctx.rings, closed);
  };
  const centroidPath = geoPath(projection);

  const nation = pathOf(feature(topo, obj.nation));
  // Interior borders only, as one stroke (cheaper than 50 outlined shapes for the faint backdrop).
  const borders = pathOf(mesh(topo, obj.states, (a, b) => a !== b), false);
  const rows = kept
    .map((f) => {
      const [code, name] = STATES[String(f.id)]!;
      const [cx, cy] = centroidPath.centroid(f as Geo);
      return { code, name, d: pathOf(f), cx: r1(cx), cy: r1(cy) };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  const body = [
    "/**",
    " * GENERATED by scripts/gen-us-paths.ts. Do not edit by hand.",
    ` * geoAlbersUsa fitted to ${W}x${H}, Douglas-Peucker simplified to ${TOLERANCE}px. Source: us-atlas states-10m (public domain).`,
    " * Import from server components only: the SVG is rendered on the server and never ships as client JS.",
    " */",
    `export const US_VIEWBOX = { width: ${W}, height: ${H} } as const;`,
    "",
    "export interface UsStatePath {",
    "  code: string;",
    "  name: string;",
    "  /** SVG path data in viewBox units. */",
    "  d: string;",
    "  /** Projected centroid in viewBox units. */",
    "  cx: number;",
    "  cy: number;",
    "}",
    "",
    `export const US_NATION_PATH = ${JSON.stringify(nation)};`,
    "",
    `export const US_BORDERS_PATH = ${JSON.stringify(borders)};`,
    "",
    "export const US_STATES: Record<string, UsStatePath> = {",
    ...rows.map((r) => `  ${r.code}: ${JSON.stringify(r)},`),
    "};",
    "",
  ].join("\n");
  writeFileSync(OUT, body);
  console.log(`wrote ${OUT} (${(body.length / 1024).toFixed(1)} KB, ${rows.length} states)`);
}

main();
