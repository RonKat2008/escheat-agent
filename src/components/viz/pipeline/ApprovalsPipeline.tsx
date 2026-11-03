"use client";

import Link from "next/link";
import { m } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { InstrumentLabel } from "@/components/primitives";
import { SrTable } from "@/components/viz/core/SrTable";
import { useInViewport } from "@/components/viz/core/useInViewport";
import { useRenderTier } from "@/components/viz/core/useRenderTier";
import { VIZ } from "@/components/viz/core/palette";
import { formatUSD } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Pipeline, PipelineLane, PipelineLaneId, PipelineStage } from "@/lib/queries/pipeline";

export interface ApprovalsPipelineProps {
  pipeline: Pipeline;
  /** Outreach nodes filter the list on this page; other lanes link to their own pages. */
  onSelectOutreach?: (status: string) => void;
  /** The outreach status the list is filtered to, if any (that node reads as pressed). */
  activeStatus?: string | null;
}

/** R4-19: the diagram starts collapsed to a one-line strip; "1" here means the reviewer chose to keep it open. */
const EXPAND_KEY = "es-pipeline-expanded";
const LANE_HREF: Record<Exclude<PipelineLaneId, "outreach">, string> = { reports: "/reports", recoveries: "/recoveries" };
/** Statuses after the gate that mean the lane is moving on its own (the agent is working): their rails flow. */
const MOVING = new Set(["approved", "sent", "claim_submitted", "submitted"]);

function readExpanded(): boolean {
  try {
    return window.localStorage.getItem(EXPAND_KEY) === "1";
  } catch {
    return false;
  }
}

/** The one-line summary: the gate's share per kind, so the pink numbers are visible without the diagram. */
function GateSummary({ pipeline }: { pipeline: Pipeline }) {
  const parts = [
    ...pipeline.lanes.map((l) => ({ key: l.id, label: l.label, n: l.waiting })),
    { key: "owner", label: "Owner replies", n: pipeline.ownerTasks },
    { key: "rules", label: "Rule changes", n: pipeline.ruleChanges },
  ].filter((p) => p.n > 0);
  if (parts.length === 0) return null;
  return (
    <ul className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-fg-3" aria-label="Waiting on you, by kind" data-testid="pipeline-summary">
      {parts.map((p) => (
        <li key={p.key} className="whitespace-nowrap">
          {p.label} <span className="num font-mono text-pink-300">{p.n}</span>
        </li>
      ))}
    </ul>
  );
}

/** The part of a node's name that is not on screen; it rides in an sr-only span so the name still starts with the visible text. */
function nodeExtra(lane: PipelineLane, s: PipelineStage): string {
  const money = s.count > 0 && s.cents > 0 ? `, ${formatUSD(s.cents)}` : "";
  return `${money}, ${lane.label}${s.gate ? ", waits on you" : ""}`;
}

/** A rail between two nodes. Flowing dashes only when items are moving through it, the tier is full and it is in view. */
function Rail({ live, flowing }: { live: boolean; flowing: boolean }) {
  return (
    <svg aria-hidden className="absolute top-1/2 left-0 h-2 w-full -translate-y-1/2" preserveAspectRatio="none" viewBox="0 0 100 8">
      <m.line
        x1="0"
        x2="100"
        y1="4"
        y2="4"
        stroke={live ? VIZ.blue500 : VIZ.lineStrong}
        strokeWidth={live ? 1.5 : 1}
        strokeDasharray={live ? "6 4" : "3 4"}
        vectorEffect="non-scaling-stroke"
        initial={false}
        animate={flowing ? { strokeDashoffset: [10, 0] } : { strokeDashoffset: 0 }}
        transition={flowing ? { duration: 0.9, ease: "linear", repeat: Infinity } : { duration: 0 }}
      />
    </svg>
  );
}

function Node({
  lane,
  stage,
  pressed,
  onSelect,
}: {
  lane: PipelineLane;
  stage: PipelineStage;
  pressed: boolean;
  onSelect?: (status: string) => void;
}) {
  const human = stage.gate && stage.count > 0;
  const zero = stage.count === 0;
  const cls = cn(
    "relative z-10 flex min-h-11 w-full flex-col items-start justify-center rounded-md border px-2.5 py-1.5 text-left transition-colors duration-150",
    human ? "border-pink-500 bg-ink-1 hover:bg-pink-950" : zero ? "border-dashed border-line-strong bg-ink-0 hover:bg-ink-2" : "border-line-hover bg-ink-2 hover:bg-ink-3",
    pressed && "border-blue-400 bg-blue-900",
  );
  const extra = `${nodeExtra(lane, stage)}. ${lane.id === "outreach" ? "Show in the list" : `Open ${lane.label}`}`;
  const body: ReactNode = (
    <>
      <span className={cn("text-[11px] leading-4 whitespace-nowrap", human ? "text-pink-300" : zero ? "text-fg-3" : "text-fg-2")}>{stage.label}</span>
      <span className="sr-only"> </span>
      <span className={cn("num font-mono text-[13px] leading-5", human ? "text-pink-400" : zero ? "text-fg-3" : "text-fg-1")}>{stage.count}</span>
      <span className="sr-only">{extra}</span>
    </>
  );
  if (lane.id !== "outreach") {
    return (
      <Link href={LANE_HREF[lane.id]} className={cls} data-pipeline-node={`${lane.id}:${stage.status}`}>
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      aria-pressed={pressed}
      onClick={() => onSelect?.(stage.status)}
      data-pipeline-node={`${lane.id}:${stage.status}`}
    >
      {body}
    </button>
  );
}

function Lane({ lane, row, flowing, activeStatus, onSelect }: { lane: PipelineLane; row: number; flowing: boolean; activeStatus?: string | null; onSelect?: (s: string) => void }) {
  const moving = lane.stages.some((s) => s !== null && MOVING.has(s.status) && s.count > 0);
  const off = lane.offRamp.filter((s) => s.count > 0);
  return (
    <>
      <div className="flex flex-col justify-center pr-3" style={{ gridRow: row, gridColumn: 1 }}>
        <InstrumentLabel>{lane.label}</InstrumentLabel>
        {off.length > 0 ? (
          <span className="mt-0.5 text-[11px] text-fg-3">
            {off.map((s) => `${s.label} ${s.count}`).join(" · ")}
          </span>
        ) : null}
      </div>
      {lane.stages.map((s, i) => {
        if (!s) return <div key={i} aria-hidden style={{ gridRow: row, gridColumn: i + 2 }} />;
        const prev = lane.stages[i - 1];
        const live = Boolean(prev && (prev.count > 0 || s.count > 0));
        return (
          <div key={s.status} className="relative flex items-center px-2 py-2" style={{ gridRow: row, gridColumn: i + 2 }}>
            {prev ? (
              <span className="absolute top-1/2 -left-2 h-2 w-4 -translate-y-1/2">
                <Rail live={live} flowing={flowing && moving && live} />
              </span>
            ) : null}
            <Node lane={lane} stage={s} pressed={lane.id === "outreach" && activeStatus === s.status} onSelect={onSelect} />
          </div>
        );
      })}
    </>
  );
}

/**
 * The approvals pipeline (DESIGN-V3 §4.3): three lanes, Outreach, Reports and Recoveries, whose awaiting_approval nodes
 * line up in one pink gate column labelled YOU. The agent does everything up to the gate; nothing passes it without a
 * person. Counts come from getPipeline (real rows); the gate total is the same number as the sidebar badge.
 */
export function ApprovalsPipeline({ pipeline, onSelectOutreach, activeStatus }: ApprovalsPipelineProps) {
  const [collapsed, setCollapsed] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInViewport(ref);
  const tier = useRenderTier();
  useEffect(() => {
    // Read after mount so the server render (collapsed) and the first client render agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (readExpanded()) setCollapsed(false);
  }, []);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(EXPAND_KEY, next ? "0" : "1");
    } catch {
      /* storage blocked: the choice lasts for this view only */
    }
  };

  const columns = pipeline.lanes[0]?.stages.length ?? 0;
  const gateIndex = pipeline.lanes[0]?.stages.findIndex((s) => s?.gate) ?? -1;
  const total = pipeline.gateTotal;
  const flowing = tier === "full" && inView;
  // Waiting items with no lane of their own still count in the gate total; say so under the gate.
  const extraParts = [
    pipeline.ownerTasks > 0 ? `${pipeline.ownerTasks} owner ${pipeline.ownerTasks === 1 ? "reply" : "replies"} to act on` : null,
    pipeline.ruleChanges > 0 ? `${pipeline.ruleChanges} rule ${pipeline.ruleChanges === 1 ? "change" : "changes"}` : null,
  ].filter((x): x is string => x !== null);
  const extra = extraParts.length ? `${extraParts.join(" · ")} also ${pipeline.ownerTasks + pipeline.ruleChanges === 1 ? "waits" : "wait"} on you` : null;

  return (
    <section
      aria-labelledby="pipeline-title"
      data-testid="approvals-pipeline"
      data-expanded={collapsed ? "false" : "true"}
      data-gate-extra={pipeline.ownerTasks + pipeline.ruleChanges}
      className={cn("rounded-[10px] border border-line bg-ink-1", collapsed ? "mb-3" : "mb-6")}
    >
      <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4", collapsed ? "py-2" : "py-3")}>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <InstrumentLabel as="h2" id="pipeline-title">
            Approvals pipeline
          </InstrumentLabel>
          <p className="text-[13px] text-fg-2">
            <span className={cn("num font-mono", total > 0 ? "text-pink-400" : "text-fg-3")} data-testid="pipeline-gate-total">
              {total}
            </span>{" "}
            {total === 1 ? "thing waits" : "things wait"} on you
            <span className={collapsed ? "sr-only" : undefined}>. The agent prepares everything up to the gate; nothing passes it without a person.</span>
          </p>
          {collapsed ? <GateSummary pipeline={pipeline} /> : null}
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls="pipeline-body"
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs text-fg-2 transition-colors duration-150 hover:bg-ink-3 hover:text-fg-1"
        >
          {collapsed ? "Show diagram" : "Collapse"}
          <ChevronDown className={cn("size-3.5 transition-transform duration-150", !collapsed && "rotate-180")} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      <div id="pipeline-body" hidden={collapsed} className="relative">
        {/* Below 640px the track scrolls sideways; a fade on the right edge says there is more (R4-19). */}
        <span aria-hidden className="pointer-events-none absolute top-px right-0 bottom-0 z-20 w-10 rounded-br-[10px] bg-gradient-to-l from-ink-1 to-transparent sm:hidden" />
        <div
          ref={ref}
          tabIndex={0}
          role="region"
          aria-label="Pipeline diagram (scrolls sideways on small screens)"
          className="overflow-x-auto overscroll-x-contain border-t border-line px-4 pt-3 pb-4 [contain:inline-size] [scrollbar-width:thin]"
        >
          <div className="relative grid min-w-[860px] gap-y-1" style={{ gridTemplateColumns: `104px repeat(${columns}, minmax(96px, 1fr))` }}>
            {gateIndex >= 0 ? (
              <div
                aria-hidden
                className={cn("pointer-events-none rounded-[10px] border bg-pink-950", total > 0 ? "glow-human border-pink-600" : "border-dashed border-line-strong")}
                style={{ gridColumn: gateIndex + 2, gridRow: `1 / span ${pipeline.lanes.length + 1}` }}
              />
            ) : null}
            {pipeline.lanes.map((lane, i) => (
              <Lane key={lane.id} lane={lane} row={i + 1} flowing={flowing} activeStatus={activeStatus} onSelect={onSelectOutreach} />
            ))}
            <div className="flex items-center justify-center pb-1" style={{ gridColumn: gateIndex + 2, gridRow: pipeline.lanes.length + 1 }}>
              <span className={cn("instrument-label", total > 0 ? "text-pink-400" : "text-fg-3")}>You</span>
            </div>
            {extra ? (
              <div
                className="flex items-center text-[11px] text-fg-3"
                style={{ gridColumn: `${gateIndex + 3} / span 4`, gridRow: pipeline.lanes.length + 1 }}
                data-testid="pipeline-gate-extra"
              >
                + {extra}
              </div>
            ) : null}
          </div>
        </div>
        {/* A table ignores width/overflow, so the sr-only table needs a clipping block around it or it widens the page. */}
        <div className="sr-only">
          <SrTable
            caption="Approvals pipeline: items per stage"
            columns={["Lane", ...(pipeline.lanes[0]?.stages.map((_, i) => `Step ${i + 1}`) ?? []), "Waiting on you"]}
            rows={pipeline.lanes.map((l) => [l.label, ...l.stages.map((s) => (s ? `${s.label}: ${s.count}` : "")), String(l.waiting)])}
          />
        </div>
      </div>
    </section>
  );
}
