import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatLifecycleDate, type LcSegment, type LcVertical, type LcVerticalItem, type LifecycleNode } from "./lifecycle-model";

/**
 * The narrow-container form of the lifecycle rail: a vertical rail with one row per stage in date order, TODAY as its
 * own row where the demo date falls, and Unknown stages listed after (never given a date). Plain HTML so every label
 * wraps naturally and stays fully legible at 280px.
 */

const segClass = (s: LcSegment) => (s === "past" ? "bg-blue-500" : "bg-line-strong");

function Rail({ before, after, children }: { before: LcSegment | null; after: LcSegment | null; children: ReactNode }) {
  return (
    <span aria-hidden className="relative block">
      {before ? <span className={cn("absolute top-0 left-[13px] h-[19px] w-0.5", segClass(before))} /> : null}
      {after ? <span className={cn("absolute top-[19px] bottom-0 left-[13px] w-0.5", segClass(after))} /> : null}
      {children}
    </span>
  );
}

function Dot({ n }: { n: LifecycleNode }) {
  const base = "absolute top-[14px] left-[9px] size-2.5 rounded-full";
  if (n.state === "unknown") return <span className={cn(base, "border-[1.5px] border-dashed border-fg-4")} />;
  if (n.state === "past") return <span className={cn(base, "bg-blue-500")} />;
  if (n.state === "next") return <span className={cn(base, "bg-ink-0 ring-2", n.urgent ? "ring-pink-500" : "ring-blue-500")} />;
  return <span className={cn(base, "border-[1.5px] border-fg-3 bg-ink-0")} />;
}

function Unverified() {
  return (
    <span className="mt-1 inline-flex h-[15px] items-center rounded-[2px] border border-line-strong px-1 font-mono text-[9.5px] leading-none tracking-[0.06em] text-fg-2">
      UNVERIFIED
    </span>
  );
}

function StageRow({ item }: { item: Extract<LcVerticalItem, { kind: "node" }> }) {
  const n = item.node;
  const unknown = n.state === "unknown";
  const date = n.date ? formatLifecycleDate(n.date) : n.reason === "not_applicable" ? "Not applicable" : "Unknown";
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)]" data-testid="lifecycle-label" data-key={n.key} data-state={n.state}>
      <Rail before={item.segBefore} after={item.segAfter}>
        <Dot n={n} />
      </Rail>
      <div className="min-w-0 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn("text-[13px] leading-[18px] font-medium", unknown ? "text-fg-2" : "text-fg-1")}>{n.label}</span>
          {n.state === "next" ? (
            <span className={cn("font-mono text-[10px] tracking-[0.08em]", n.urgent ? "text-pink-400" : "text-blue-300")}>
              {n.urgent ? "NEXT, WITHIN 7 DAYS" : "NEXT"}
            </span>
          ) : null}
        </div>
        <span className={cn("num block font-mono text-xs leading-4", unknown ? "text-fg-3" : n.urgent ? "text-pink-400" : "text-fg-2")}>{date}</span>
        {n.unverified ? <Unverified /> : null}
      </div>
    </li>
  );
}

function TodayRow({ item }: { item: Extract<LcVerticalItem, { kind: "today" }> }) {
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)]" data-testid="lifecycle-label" data-key="__today">
      <Rail before={item.segBefore} after={item.segAfter}>
        <span className="absolute top-[18px] left-[6px] h-0.5 w-4 rounded-full bg-blue-400" />
      </Rail>
      <div className="flex min-w-0 items-baseline gap-2 py-2">
        <span className="font-mono text-[10px] tracking-[0.08em] text-blue-300">TODAY</span>
        <span className="num font-mono text-xs text-fg-2">{formatLifecycleDate(item.date)}</span>
      </div>
    </li>
  );
}

export function LifecycleRailList({ vertical, label, className }: { vertical: LcVertical; label: string; className?: string }) {
  return (
    <div className={className} data-testid="lifecycle-list">
      <ol className="m-0 list-none p-0" aria-label={label}>
        {vertical.items.map((item) =>
          item.kind === "today" ? <TodayRow key="__today" item={item} /> : <StageRow key={item.node.key} item={item} />,
        )}
      </ol>
      {vertical.unknown.length > 0 ? (
        <div className="mt-2 rounded-md border border-dashed border-fg-4 px-1 pt-2">
          <p className="m-0 pl-1 font-mono text-[10px] tracking-[0.08em] text-fg-3">UNKNOWN</p>
          <ol className="m-0 list-none p-0" aria-label="Stages without a computed date">
            {vertical.unknown.map((item) => (item.kind === "node" ? <StageRow key={item.node.key} item={item} /> : null))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
