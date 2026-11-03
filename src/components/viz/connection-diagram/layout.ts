import type { DiagramNode, NodeGroup } from "./model";

/** Fixed SVG geometry for the connection diagram (viewBox units). Pure, so it is unit tested with the model. */
export const VIEW_W = 760;
export const VIEW_H = 400;
export const NODE_W = 184;
export const NODE_H = 54;
export const HUB = { x: 380, y: 160, w: 172, h: 64 } as const;

const COL_X: Record<Exclude<NodeGroup, "engine">, number> = { input: 24, output: VIEW_W - 24 - NODE_W };
const ROW_Y = [36, 133, 230];
const ENGINE_Y = 316;
const ENGINE_X = [HUB.x - NODE_W - 12, HUB.x + 12];

export interface PlacedNode extends DiagramNode {
  x: number;
  y: number;
  /** Path from the node to the hub (inputs and engine) or from the hub to the node (outputs): data direction. */
  d: string;
}

const r = (n: number) => Math.round(n * 10) / 10;

function curve(x1: number, y1: number, x2: number, y2: number, vertical: boolean): string {
  if (vertical) {
    const my = (y1 + y2) / 2;
    return `M${r(x1)} ${r(y1)}C${r(x1)} ${r(my)} ${r(x2)} ${r(my)} ${r(x2)} ${r(y2)}`;
  }
  const mx = (x1 + x2) / 2;
  return `M${r(x1)} ${r(y1)}C${r(mx)} ${r(y1)} ${r(mx)} ${r(y2)} ${r(x2)} ${r(y2)}`;
}

/** Places nodes in three columns (inputs left, outputs right) and an engine row under the hub. */
export function placeNodes(nodes: readonly DiagramNode[]): PlacedNode[] {
  const seen: Record<NodeGroup, number> = { input: 0, output: 0, engine: 0 };
  const hubMidY = HUB.y + HUB.h / 2;
  return nodes.map((n) => {
    const i = seen[n.group]++;
    if (n.group === "engine") {
      const x = ENGINE_X[i % ENGINE_X.length]!;
      const hubX = HUB.x - HUB.w / 4 + (i % 2) * (HUB.w / 2);
      return { ...n, x, y: ENGINE_Y, d: curve(x + NODE_W / 2, ENGINE_Y, hubX, HUB.y + HUB.h, true) };
    }
    const x = COL_X[n.group];
    const y = ROW_Y[i % ROW_Y.length]!;
    const midY = y + NODE_H / 2;
    const d =
      n.group === "input"
        ? curve(x + NODE_W, midY, HUB.x - HUB.w / 2, hubMidY, false)
        : curve(HUB.x + HUB.w / 2, hubMidY, x, midY, false);
    return { ...n, x, y, d };
  });
}
