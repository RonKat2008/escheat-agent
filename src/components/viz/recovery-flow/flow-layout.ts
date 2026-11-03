/** d3-sankey layout for the recovery flow. Pure (no React); link widths are proportional to cents. */
import { sankey, sankeyLeft, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from "d3-sankey";
import type { FlowLink, FlowNode, RecoveryFlowModel } from "./flow-model";

export type LaidNode = SankeyNode<FlowNode, FlowLink> & { x0: number; x1: number; y0: number; y1: number };
export type LaidLink = SankeyLink<FlowNode, FlowLink> & { width: number; path: string; source: LaidNode; target: LaidNode };

export interface FlowLayout {
  nodes: LaidNode[];
  links: LaidLink[];
  width: number;
  height: number;
}

export function layoutRecoveryFlow(model: RecoveryFlowModel, width: number, height: number, pad = { left: 4, right: 4, top: 8, bottom: 8 }): FlowLayout {
  if (model.links.length === 0) return { nodes: [], links: [], width, height };
  const gen = sankey<FlowNode, FlowLink>()
    .nodeId((d) => d.id)
    .nodeAlign(sankeyLeft)
    .nodeWidth(10)
    .nodePadding(16)
    .nodeSort((a, b) => a.column - b.column)
    .extent([
      [pad.left, pad.top],
      [width - pad.right, height - pad.bottom],
    ]);
  // d3-sankey mutates its input: hand it copies, with `value` = cents.
  const graph = gen({
    nodes: model.nodes.map((n) => ({ ...n })),
    links: model.links.map((l) => ({ ...l, value: l.cents })),
  });
  const path = sankeyLinkHorizontal<FlowNode, FlowLink>();
  return {
    nodes: graph.nodes as LaidNode[],
    links: graph.links.map((l) => Object.assign(l, { path: path(l) ?? "" }) as LaidLink),
    width,
    height,
  };
}
