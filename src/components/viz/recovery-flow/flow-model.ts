/**
 * Pure model for the compact recovery flow (DESIGN-V3 §4.2 compact variant, §6.11): State portals → Found → Claimed →
 * Paid, built from `recoveries` rows only. Nothing is back-filled: a stage with no rows has no node, and a zero link is
 * dropped rather than drawn as a hairline. Every non-terminal node conserves money: incoming cents = outgoing cents.
 */

export type RecoveryStatus = "found" | "claim_drafted" | "awaiting_approval" | "claim_submitted" | "paid" | "rejected";

export interface RecoveryFlowRow {
  state: string;
  status: RecoveryStatus;
  amountCents: number;
  /** A person has approved the claim (an approval row exists). */
  approved: boolean;
}

export type FlowNodeId = `portal:${string}` | "found" | "needs_you" | "approved" | "claimed" | "paid" | "pending" | "rejected";

/** How the node is drawn: needs a person (pink), done (blue-300), in motion (blue), neutral. */
export type FlowTone = "human" | "done" | "active" | "neutral";

export interface FlowNode {
  id: FlowNodeId;
  label: string;
  column: 0 | 1 | 2 | 3;
  cents: number;
  count: number;
  tone: FlowTone;
}

export interface FlowLink {
  source: FlowNodeId;
  target: FlowNodeId;
  cents: number;
  count: number;
}

export interface RecoveryFlowModel {
  nodes: FlowNode[];
  links: FlowLink[];
  totalCents: number;
  totalCount: number;
}

const NODE_META: Record<Exclude<FlowNodeId, `portal:${string}`>, Omit<FlowNode, "id" | "cents" | "count">> = {
  found: { label: "Found", column: 1, tone: "neutral" },
  needs_you: { label: "Needs your approval", column: 2, tone: "human" },
  approved: { label: "Approved, not filed", column: 2, tone: "active" },
  claimed: { label: "Claimed", column: 2, tone: "active" },
  paid: { label: "Paid", column: 3, tone: "done" },
  pending: { label: "Waiting on the state", column: 3, tone: "active" },
  rejected: { label: "Rejected", column: 3, tone: "neutral" },
};

/** The path one recovery takes through the flow, from its stored status and approval only. */
export function pathOf(r: RecoveryFlowRow): FlowNodeId[] {
  const portal = `portal:${r.state.toUpperCase()}` as const;
  switch (r.status) {
    case "paid":
      return [portal, "found", "claimed", "paid"];
    case "claim_submitted":
      return [portal, "found", "claimed", "pending"];
    case "rejected":
      return [portal, "found", "claimed", "rejected"];
    default:
      return [portal, "found", r.approved ? "approved" : "needs_you"];
  }
}

export function buildRecoveryFlow(rows: readonly RecoveryFlowRow[]): RecoveryFlowModel {
  const nodes = new Map<FlowNodeId, FlowNode>();
  const links = new Map<string, FlowLink>();
  let totalCents = 0;
  let totalCount = 0;

  for (const r of rows) {
    if (!(r.amountCents > 0)) continue; // a zero or negative amount carries no flow
    totalCents += r.amountCents;
    totalCount += 1;
    const path = pathOf(r);
    path.forEach((id, i) => {
      const meta = id.startsWith("portal:") ? { label: `${id.slice(7)} portal`, column: 0 as const, tone: "neutral" as const } : NODE_META[id as keyof typeof NODE_META];
      const n = nodes.get(id) ?? { id, ...meta, cents: 0, count: 0 };
      nodes.set(id, { ...n, cents: n.cents + r.amountCents, count: n.count + 1 });
      if (i === 0) return;
      const key = `${path[i - 1]}>${id}`;
      const l = links.get(key) ?? { source: path[i - 1]!, target: id, cents: 0, count: 0 };
      links.set(key, { ...l, cents: l.cents + r.amountCents, count: l.count + 1 });
    });
  }

  const order = (n: FlowNode) => n.column * 100 + (n.id.startsWith("portal:") ? 0 : Object.keys(NODE_META).indexOf(n.id));
  return {
    nodes: [...nodes.values()].sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id)),
    links: [...links.values()].filter((l) => l.cents > 0),
    totalCents,
    totalCount,
  };
}

/** Sum of link cents into and out of each node (for conservation checks and tooltips). */
export function nodeBalance(model: Pick<RecoveryFlowModel, "links">): Map<FlowNodeId, { in: number; out: number }> {
  const m = new Map<FlowNodeId, { in: number; out: number }>();
  for (const l of model.links) {
    const s = m.get(l.source) ?? { in: 0, out: 0 };
    m.set(l.source, { ...s, out: s.out + l.cents });
    const t = m.get(l.target) ?? { in: 0, out: 0 };
    m.set(l.target, { ...t, in: t.in + l.cents });
  }
  return m;
}
