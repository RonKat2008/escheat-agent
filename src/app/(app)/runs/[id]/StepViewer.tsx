"use client";

import { CheckCircle2, ChevronRight, CircleAlert, CircleDashed, PauseCircle } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/primitives";
import { JsonView } from "@/components/b/JsonView";
import { formatDuration, type TraceStepView } from "@/components/b/trace";
import { cn } from "@/lib/utils";

const TONE_ICON = {
  neutral: { Icon: CircleDashed, cls: "text-muted-foreground" },
  ok: { Icon: CheckCircle2, cls: "text-blue-400" },
  warn: { Icon: PauseCircle, cls: "text-pink-400" },
  error: { Icon: CircleAlert, cls: "text-pink-400" },
} as const;

export function StepViewer({ steps }: { steps: TraceStepView[] }) {
  const [sel, setSel] = useState(() => {
    const withData = steps.findIndex((s) => s.data != null && typeof s.data === "object" && Object.keys(s.data as object).length > 0);
    return withData >= 0 ? withData : Math.max(0, steps.length - 1);
  });
  const total = steps.reduce((s, x) => s + (x.durationMs ?? 0), 0);
  if (steps.length === 0) {
    return (
      <div className="rounded-[14px] border border-border bg-surface p-5">
        <EmptyState title="No steps recorded" description="This run did not record a trace. The input and output below are everything it stored." />
      </div>
    );
  }
  const cur = steps[Math.min(sel, steps.length - 1)]!;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      setSel((s) => Math.min(steps.length - 1, s + 1));
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    }
  };
  return (
    <div className="grid overflow-hidden rounded-[14px] border border-border bg-surface lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
      <div className="max-h-[560px] overflow-y-auto border-b border-border p-2 lg:border-r lg:border-b-0" onKeyDown={onKey}>
        <h2 className="px-2.5 pt-1.5 pb-2 text-[15px] font-semibold">Steps</h2>
        <ol className="space-y-0.5">
          {steps.map((s, i) => {
            const { Icon, cls } = TONE_ICON[s.tone];
            const share = total > 0 && s.durationMs != null ? Math.max(0.02, s.durationMs / total) : 0;
            return (
              <li key={i}>
                <button
                  type="button"
                  aria-current={i === sel ? "step" : undefined}
                  onClick={() => setSel(i)}
                  className={cn(
                    "relative w-full rounded-lg px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    i === sel ? "bg-raised" : "hover:bg-raised/60",
                  )}
                >
                  <span className="flex items-start gap-2.5">
                    <Icon className={cn("mt-0.5 size-4 shrink-0", cls)} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] leading-5">
                        <span className="mr-1.5 font-mono text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                        {s.label}
                      </span>
                      {share > 0 ? (
                        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
                          <span className="block h-full origin-left rounded-full bg-fg-3" style={{ transform: `scaleX(${share})`, width: "100%" }} />
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{formatDuration(s.durationMs)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="min-w-0 space-y-4 p-5" aria-live="polite">
        <div>
          <p className="flex items-center gap-1.5 text-xs text-fg-3">
            Step {cur.index + 1} <ChevronRight className="size-3" aria-hidden /> {cur.kind.replace(/_/g, " ")}
          </p>
          <h3 className="mt-1 text-base leading-6 font-semibold break-words">{cur.label}</h3>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {cur.at ? cur.at.replace("T", " ").replace(/\.\d+Z$/, "Z") : "No timestamp"}
            {cur.durationMs != null ? ` · ${formatDuration(cur.durationMs)}` : ""}
          </p>
        </div>
        {cur.data != null && !(typeof cur.data === "object" && Object.keys(cur.data as object).length === 0) ? (
          <JsonView label="Details" value={cur.data} />
        ) : (
          <p className="text-sm text-muted-foreground">This step recorded no payload.</p>
        )}
        {cur.screenshot ? <p className="font-mono text-xs break-all text-muted-foreground">Screenshot: {cur.screenshot}</p> : null}
      </div>
    </div>
  );
}
