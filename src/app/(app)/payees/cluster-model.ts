/**
 * Alias cluster layout (DESIGN-V3 §6.5): the selected payee's canonical name in the middle, each raw ledger name variant
 * on a spoke, the edge labelled with the merge basis. A model merge stays "pending" (pink) until a person confirms it.
 * Pure: names and line counts come from getPayeeDetail; nothing is inferred here.
 */

export type MergeBasis = "exact" | "rule" | "model" | "human";

export interface ClusterInput {
  canonicalName: string;
  aliases: readonly string[];
  rawNames: readonly { name: string; lines: number }[];
  mergeBasis: MergeBasis;
  /** A person has reviewed this payee (merge, split, rename or confirm). */
  humanReviewed: boolean;
}

export interface ClusterSpoke {
  name: string;
  lines: number;
  basis: MergeBasis;
  /** Model merge nobody has confirmed: drawn pink. */
  pending: boolean;
  x: number;
  y: number;
  /** Text anchor for the label, so labels point away from the centre. */
  anchor: "start" | "middle" | "end";
}

export interface ClusterLayout {
  center: { name: string; lines: number };
  spokes: ClusterSpoke[];
  hidden: number;
  width: number;
  height: number;
}

export const MAX_SPOKES = 8;

export function layoutCluster(input: ClusterInput, width = 480, height = 220): ClusterLayout {
  const canonicalKey = input.canonicalName.trim().toLowerCase();
  const lines = new Map(input.rawNames.map((r) => [r.name, r.lines]));
  const names: string[] = [];
  const seen = new Set<string>([canonicalKey]);
  for (const n of [...input.rawNames.map((r) => r.name), ...input.aliases]) {
    const k = n.trim().toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    names.push(n);
  }
  const shown = names.slice(0, MAX_SPOKES);
  const cx = width / 2;
  const cy = height / 2;
  const rx = Math.min(width * 0.36, 180);
  const ry = Math.min(height * 0.36, 80);
  const basis: MergeBasis = input.humanReviewed ? "human" : input.mergeBasis;
  const spokes = shown.map((name, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, shown.length);
    const x = cx + rx * Math.cos(a);
    const y = cy + ry * Math.sin(a);
    const dx = x - cx;
    return {
      name,
      lines: lines.get(name) ?? 0,
      basis,
      pending: basis === "model",
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      anchor: (Math.abs(dx) < 8 ? "middle" : dx > 0 ? "start" : "end") as ClusterSpoke["anchor"],
    };
  });
  return {
    center: { name: input.canonicalName, lines: lines.get(input.canonicalName) ?? 0 },
    spokes,
    hidden: names.length - shown.length,
    width,
    height,
  };
}
