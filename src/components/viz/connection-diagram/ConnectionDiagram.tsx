"use client";

import { DrawPath } from "@/components/motion/DrawPath";
import { SrTable } from "@/components/viz/core/SrTable";
import { VIZ } from "@/components/viz/core/palette";
import { useRenderTier } from "@/components/viz/core/useRenderTier";
import { HUB, NODE_H, NODE_W, VIEW_H, VIEW_W, placeNodes, type PlacedNode } from "./layout";
import type { DiagramNode, LinkState } from "./model";

const STROKE: Record<LinkState, { color: string; dash?: string; width: number }> = {
  live: { color: VIZ.blue500, width: 1.75 },
  simulated: { color: VIZ.blue400, dash: "2 5", width: 1.5 },
  off: { color: VIZ.fg4, dash: "5 6", width: 1.25 },
  blocked: { color: VIZ.pink500, dash: "5 6", width: 1.5 },
};

const STATUS_TEXT: Record<LinkState, string> = {
  live: VIZ.blue300,
  simulated: VIZ.blue400,
  off: VIZ.fg3,
  blocked: VIZ.pink400,
};

const GROUP_LABEL = { input: "Sources", output: "Outputs", engine: "Engine" } as const;

/** Status shape first (§1.2): filled = live, ring with a dot = simulated, dashed ring = off, x = blocked. */
function StatusShape({ link, cx, cy }: { link: LinkState; cx: number; cy: number }) {
  if (link === "live") return <circle cx={cx} cy={cy} r={4} fill={VIZ.blue500} />;
  if (link === "simulated") {
    return (
      <g>
        <circle cx={cx} cy={cy} r={4} fill="none" stroke={VIZ.blue400} strokeWidth={1.25} />
        <circle cx={cx} cy={cy} r={1.5} fill={VIZ.blue400} />
      </g>
    );
  }
  if (link === "blocked") {
    return (
      <g stroke={VIZ.pink500} strokeWidth={1.5} strokeLinecap="round">
        <path d={`M${cx - 3.5} ${cy - 3.5}L${cx + 3.5} ${cy + 3.5}M${cx + 3.5} ${cy - 3.5}L${cx - 3.5} ${cy + 3.5}`} />
      </g>
    );
  }
  return <circle cx={cx} cy={cy} r={4} fill="none" stroke={VIZ.fg3} strokeWidth={1.25} strokeDasharray="2 2" />;
}

function NodeBox({ n }: { n: PlacedNode }) {
  return (
    <g data-testid={`connection-node-${n.id}`} data-status={n.status} data-link={n.link}>
      <rect x={n.x} y={n.y} width={NODE_W} height={NODE_H} rx={8} fill={VIZ.ink2} stroke={n.link === "blocked" ? VIZ.pink700 : VIZ.lineStrong} />
      <text x={n.x + 14} y={n.y + 22} fill={VIZ.fg1} fontSize={13} fontWeight={500}>
        {n.name}
      </text>
      <StatusShape link={n.link} cx={n.x + 18} cy={n.y + 38} />
      <text x={n.x + 28} y={n.y + 42} fill={STATUS_TEXT[n.link]} fontSize={12}>
        {n.statusLabel}
      </text>
    </g>
  );
}

export interface ConnectionDiagramProps {
  nodes: readonly DiagramNode[];
}

/**
 * Settings hero (DESIGN-V3 §6.15): sources → Escheat Agent → outputs, with the engine services under the hub. Live
 * links are solid blue threads, simulated ones dotted, unconfigured ones dashed fg-4, blocked ones pink. Every status
 * comes from the server's config read; nothing moves (no particles), because no data is actually flowing here.
 */
export function ConnectionDiagram({ nodes }: ConnectionDiagramProps) {
  const tier = useRenderTier();
  const placed = placeNodes(nodes);
  const summary = nodes.map((n) => `${n.name}: ${n.statusLabel}`).join("; ");
  return (
    <figure className="m-0">
      <div
        className="max-w-full overflow-x-auto rounded-[10px] border border-line bg-ink-1 [contain:inline-size] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
        tabIndex={0}
        role="region"
        aria-label="Connection diagram, scrolls sideways on small screens"
        data-testid="connection-diagram"
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="block h-auto w-full min-w-[640px]"
          role="img"
          aria-label={`Escheat Agent connections. ${summary}.`}
        >
          {(["input", "output"] as const).map((g) => (
            <text key={g} x={g === "input" ? 24 : VIEW_W - 24} y={22} textAnchor={g === "input" ? "start" : "end"} className="instrument-label" fill={VIZ.fg3} fontSize={11}>
              {GROUP_LABEL[g].toUpperCase()}
            </text>
          ))}
          <text x={24} y={VIEW_H - 8} className="instrument-label" fill={VIZ.fg3} fontSize={11}>
            {GROUP_LABEL.engine.toUpperCase()}
          </text>
          {placed.map((n, i) => {
            const s = STROKE[n.link];
            return (
              <DrawPath
                key={`link-${n.id}`}
                d={n.d}
                fill="none"
                stroke={s.color}
                strokeWidth={s.width}
                strokeDasharray={s.dash}
                strokeLinecap="round"
                delayMs={Math.min(i, 10) * 60}
                instant={tier === "static" || s.dash !== undefined}
              />
            );
          })}
          <g data-testid="connection-hub">
            <rect x={HUB.x - HUB.w / 2} y={HUB.y} width={HUB.w} height={HUB.h} rx={10} fill={VIZ.ink3} stroke={VIZ.blue700} />
            <path d={`M${HUB.x - 66} ${HUB.y + 42}l10 -10`} stroke={VIZ.blue500} strokeWidth={1.75} strokeLinecap="round" />
            <text x={HUB.x - 48} y={HUB.y + 30} fill={VIZ.fg1} fontSize={14} fontWeight={600}>
              Escheat Agent
            </text>
            <text x={HUB.x - 48} y={HUB.y + 47} fill={VIZ.fg3} fontSize={11}>
              this app
            </text>
          </g>
          {placed.map((n) => (
            <NodeBox key={n.id} n={n} />
          ))}
        </svg>
      </div>
      <SrTable
        caption="Integration status"
        columns={["Service", "Role", "Status", "What it means"]}
        rows={nodes.map((n) => [n.name, GROUP_LABEL[n.group], n.statusLabel, n.note])}
      />
    </figure>
  );
}
