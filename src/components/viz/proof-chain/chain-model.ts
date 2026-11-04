/**
 * Proof chain view model: maps the nine audit links to tones, rail styles, draw delays and their accessible text.
 * Palette rule: proven = blue, missing (a person must act) = pink, not yet due = dim, not required = muted dashed.
 * Pure; ProofChain.tsx renders it.
 */
import { STATUS_LABELS, type LinkStatus, type ProofLink } from "@/lib/audit/proof-chain";
import { VIZ } from "@/components/viz/core/palette";

export type ChainTone = "blue" | "pink" | "dim" | "muted";
export type RailStyle = "solid" | "dashed" | "dotted";

export const DRAW_STAGGER_MS = 110;

const TONE: Record<LinkStatus, ChainTone> = { proven: "blue", missing: "pink", rules_gap: "pink", not_yet_due: "dim", not_required: "muted" };
const RAIL: Record<ChainTone, RailStyle> = { blue: "solid", pink: "solid", dim: "dashed", muted: "dotted" };
const STROKE: Record<ChainTone, string> = { blue: VIZ.blue500, pink: VIZ.pink500, dim: VIZ.fg4, muted: VIZ.lineStrong };
const DASH: Record<RailStyle, string | undefined> = { solid: undefined, dashed: "5 5", dotted: "1.5 4" };

export interface ChainNode {
  link: ProofLink;
  index: number;
  /** "01".."09". */
  ordinal: string;
  tone: ChainTone;
  statusText: string;
  rail: { d: string; stroke: string; dash: string | undefined };
  /** Proven and missing beads glow (they are the facts an auditor looks at); the rest stay flat. */
  glow: boolean;
  delayMs: number;
  ariaLabel: string;
}

export interface ChainCounts {
  proven: number;
  missing: number;
  rulesGap: number;
  notYetDue: number;
  notRequired: number;
}

/**
 * The rail segment inside one column, in a 0..100 x 0..24 box: the first link starts at its centre, the last ends at
 * its centre, the rest run edge to edge, so nine columns read as one line.
 */
export function railPath(index: number, total: number): string {
  if (total <= 1) return "M50 12 H50";
  if (index === 0) return "M50 12 H100";
  if (index === total - 1) return "M0 12 H50";
  return "M0 12 H100";
}

export function chainNodes(links: readonly ProofLink[], opts: { animate?: boolean } = {}): ChainNode[] {
  const animate = opts.animate ?? true;
  return links.map((link, index) => {
    const tone = TONE[link.status];
    const rail = RAIL[tone];
    const statusText = link.unverified && link.status === "rules_gap" && link.kind === "rule" ? "Rules gap: unverified" : STATUS_LABELS[link.status];
    const ariaParts = [`Link ${index + 1}: ${link.label}`, statusText, link.evidence, link.unverified ? "depends on an unverified rule value" : "", link.fix ? `fix: ${link.fix.label}` : ""];
    return {
      link,
      index,
      ordinal: String(index + 1).padStart(2, "0"),
      tone,
      statusText,
      rail: { d: railPath(index, links.length), stroke: STROKE[tone], dash: DASH[rail] },
      glow: tone === "blue" || tone === "pink",
      delayMs: animate ? index * DRAW_STAGGER_MS : 0,
      ariaLabel: ariaParts.filter(Boolean).join(". "),
    };
  });
}

export function chainCounts(links: readonly ProofLink[]): ChainCounts {
  const n = (s: LinkStatus) => links.filter((l) => l.status === s).length;
  return { proven: n("proven"), missing: n("missing"), rulesGap: n("rules_gap"), notYetDue: n("not_yet_due"), notRequired: n("not_required") };
}

/** "3 proven, 2 missing (need a person), 4 not yet due". Zero counts are left out. */
export function chainSummary(links: readonly ProofLink[]): string {
  const c = chainCounts(links);
  const parts = [
    c.proven ? `${c.proven} proven` : "",
    c.missing ? `${c.missing} missing (need a person)` : "",
    c.rulesGap ? `${c.rulesGap} rules gap (verify the state's rules)` : "",
    c.notYetDue ? `${c.notYetDue} not yet due` : "",
    c.notRequired ? `${c.notRequired} not required` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "No links";
}

/** Rows for the visually hidden table twin: link, status, evidence, fix. */
export function chainSrRows(links: readonly ProofLink[]): string[][] {
  return chainNodes(links, { animate: false }).map((n) => [
    `${n.index + 1}. ${n.link.label}`,
    n.statusText,
    [n.link.evidence, ...n.link.detail, ...n.link.sources.map((s) => `Source: ${s.title}`)].join(" "),
    n.link.fix ? `${n.link.fix.label} (${n.link.fix.href})` : "",
  ]);
}
