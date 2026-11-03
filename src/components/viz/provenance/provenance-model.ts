import { linkHorizontal } from "d3-shape";

/**
 * Rule provenance graph (DESIGN-V3 §4.4): a left-to-right layered graph
 *   [derivation steps] → Value → Rule path → Sources (1..n) → Verification
 * Pure layout: column x is fixed, y is by index, every column is centered on the tallest one. Links are d3-shape
 * linkHorizontal curves from the right edge of a node to the left edge of the next. No values are invented: an
 * unknown value is a hollow, dashed node and an unverified value says UNVERIFIED.
 */

export type ProvenanceColumn = "derivation" | "value" | "path" | "source" | "verification";

export interface ProvenanceSourceInput {
  url: string;
  title?: string | null;
  quote?: string | null;
}

export interface ProvenanceInput {
  state: string;
  /** Rule field path as listRuleValues names it, e.g. "dueDiligence.requiredLanguage". */
  rulePath: string;
  /** Human text of the value, or null when it is unknown. */
  value: string | null;
  sources: ProvenanceSourceInput[];
  verified: boolean;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  /** Optional derivation sentences (item dates) feeding the value from the left. */
  derivation?: string[];
}

export interface ProvenanceNode {
  id: string;
  column: ProvenanceColumn;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  sublabel: string | null;
  /** Source nodes only: the http(s) link. */
  href: string | null;
  quote: string | null;
  /** Hollow, dashed: an unknown value or a missing link in the chain. */
  hollow: boolean;
}

export interface ProvenanceLink {
  id: string;
  from: string;
  to: string;
  d: string;
  dashed: boolean;
}

export interface ProvenanceLayout {
  width: number;
  height: number;
  columns: { column: ProvenanceColumn; label: string; x: number; width: number }[];
  nodes: ProvenanceNode[];
  links: ProvenanceLink[];
}

export interface ProvenanceLayoutOptions {
  nodeHeight?: number;
  rowGap?: number;
  colGap?: number;
  /** Space above the nodes for the column labels. */
  headerHeight?: number;
  widths?: Partial<Record<ProvenanceColumn, number>>;
}

export const COLUMN_LABEL: Record<ProvenanceColumn, string> = {
  derivation: "Derivation",
  value: "Value",
  path: "Rule path",
  source: "Sources",
  verification: "Verification",
};

const DEFAULT_WIDTHS: Record<ProvenanceColumn, number> = { derivation: 160, value: 128, path: 164, source: 176, verification: 128 };

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function isHttpUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

const link = linkHorizontal<{ source: [number, number]; target: [number, number] }, [number, number]>()
  .source((d) => d.source)
  .target((d) => d.target);

function connect(a: ProvenanceNode, b: ProvenanceNode, dashed: boolean): ProvenanceLink {
  const d = link({ source: [a.x + a.width, a.y + a.height / 2], target: [b.x, b.y + b.height / 2] }) ?? "";
  return { id: `${a.id}->${b.id}`, from: a.id, to: b.id, d, dashed };
}

function verificationText(input: ProvenanceInput): { label: string; sublabel: string | null } {
  if (!input.verified) return { label: "UNVERIFIED", sublabel: "No person has confirmed it" };
  const by = input.verifiedBy?.trim();
  const on = input.verifiedAt ? input.verifiedAt.slice(0, 10) : null;
  return { label: by ? `Verified by ${by}` : "Verified", sublabel: on ? `on ${on}` : null };
}

export function layoutProvenance(input: ProvenanceInput, opts: ProvenanceLayoutOptions = {}): ProvenanceLayout {
  const h = opts.nodeHeight ?? 56;
  const rowGap = opts.rowGap ?? 12;
  const colGap = opts.colGap ?? 28;
  const header = opts.headerHeight ?? 24;
  const widths = { ...DEFAULT_WIDTHS, ...opts.widths };

  const derivation = (input.derivation ?? []).filter((s) => s.trim().length > 0);
  const sources = input.sources.filter((s) => isHttpUrl(s.url));
  const order: ProvenanceColumn[] = [...(derivation.length > 0 ? (["derivation"] as const) : []), "value", "path", "source", "verification"];

  const columns: ProvenanceLayout["columns"] = [];
  let x = 0;
  for (const c of order) {
    columns.push({ column: c, label: COLUMN_LABEL[c], x, width: widths[c] });
    x += widths[c] + colGap;
  }
  const width = x - colGap;

  const rowsIn = (c: ProvenanceColumn) => (c === "derivation" ? derivation.length : c === "source" ? Math.max(1, sources.length) : 1);
  const colHeight = (n: number) => n * h + (n - 1) * rowGap;
  const tallest = Math.max(...order.map((c) => colHeight(rowsIn(c))));
  const height = header + tallest;
  const colX = (c: ProvenanceColumn) => columns.find((k) => k.column === c)!.x;
  const yAt = (c: ProvenanceColumn, i: number) => header + (tallest - colHeight(rowsIn(c))) / 2 + i * (h + rowGap);

  const node = (column: ProvenanceColumn, i: number, rest: Pick<ProvenanceNode, "id" | "label"> & Partial<ProvenanceNode>): ProvenanceNode => ({
    column,
    x: colX(column),
    y: yAt(column, i),
    width: widths[column],
    height: h,
    sublabel: null,
    href: null,
    quote: null,
    hollow: false,
    ...rest,
  });

  const derivNodes = derivation.map((text, i) => node("derivation", i, { id: `derivation-${i}`, label: text }));
  const valueNode = node("value", 0, { id: "value", label: input.value ?? "Unknown", hollow: input.value === null, sublabel: input.value === null ? "No value researched" : null });
  const pathNode = node("path", 0, { id: "path", label: `rules/${input.state.toUpperCase()}.json`, sublabel: input.rulePath });
  const sourceNodes =
    sources.length > 0
      ? sources.map((s, i) =>
          node("source", i, {
            id: `source-${i}`,
            label: s.title?.trim() || domainOf(s.url),
            sublabel: domainOf(s.url),
            href: s.url,
            quote: s.quote?.trim() || null,
          }),
        )
      : [node("source", 0, { id: "source-none", label: "No source cited", hollow: true })];
  const v = verificationText(input);
  const verifyNode = node("verification", 0, { id: "verification", label: v.label, sublabel: v.sublabel, hollow: !input.verified });

  const unknown = input.value === null;
  const links: ProvenanceLink[] = [
    ...derivNodes.map((d) => connect(d, valueNode, false)),
    connect(valueNode, pathNode, unknown),
    ...sourceNodes.map((s) => connect(pathNode, s, s.hollow || unknown)),
    ...sourceNodes.map((s) => connect(s, verifyNode, s.hollow || !input.verified)),
  ];

  return { width, height, columns, nodes: [...derivNodes, valueNode, pathNode, ...sourceNodes, verifyNode], links };
}

/**
 * Nodes and links on the chain through one node: everything upstream of it (following links backwards) and
 * everything downstream (following links forwards). Used for the hover highlight.
 */
export function chainThrough(layout: Pick<ProvenanceLayout, "links">, nodeId: string): { nodes: Set<string>; links: Set<string> } {
  const nodes = new Set([nodeId]);
  const links = new Set<string>();
  const walk = (start: string, forward: boolean) => {
    const queue = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const l of layout.links) {
        const [from, to] = forward ? [l.from, l.to] : [l.to, l.from];
        if (from !== cur || links.has(l.id)) continue;
        links.add(l.id);
        nodes.add(to);
        queue.push(to);
      }
    }
  };
  walk(nodeId, true);
  walk(nodeId, false);
  return { nodes, links };
}
