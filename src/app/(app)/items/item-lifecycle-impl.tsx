"use client";

import dynamic from "next/dynamic";
import { useState, useSyncExternalStore } from "react";
import { InstrumentLabel } from "@/components/primitives";
import { Segmented } from "@/components/ui/segmented";
import { LifecycleRail } from "@/components/viz/core/LifecycleRail";
import { useRenderTier } from "@/components/viz/core/useRenderTier";
import { WhyThisDate, defaultWhyKey } from "@/components/viz/why-this-date";
import type { TimelineEvent } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { TimelineNode } from "./timeline";

// Lazy: the 3D tunnel's chunk is fetched only when the user opts into the 3D view.
const LifecycleTunnel = dynamic(() => import("@/components/viz/lifecycle-tunnel").then((m) => m.LifecycleTunnel), {
  ssr: false,
  loading: () => <div className="h-48 rounded-md border border-line bg-ink-1" aria-hidden="true" />,
});

type LifecycleView = "3d" | "rail";

const PREF_KEY = "es-lifecycle-view";
const PREF_EVENT = "es-lifecycle-view-change";

function readPref(): LifecycleView {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(PREF_KEY);
  } catch {
    /* storage blocked: fall back to Rail */
  }
  if (stored === "3d" || stored === "rail") return stored;
  return "rail"; // Rail is the most legible view; 3D is opt-in. Missing or stale values land here.
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(PREF_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(PREF_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function writePref(v: LifecycleView) {
  try {
    window.localStorage.setItem(PREF_KEY, v);
  } catch {
    /* storage blocked */
  }
  window.dispatchEvent(new Event(PREF_EVENT));
}

const VIEW_OPTIONS = [
  { value: "3d", label: "3D" },
  { value: "rail", label: "Rail" },
] as const;

/**
 * The drawer's Lifecycle block (DESIGN-V3 §3.3/§6.4): the 3D tunnel or the flat rail (same data), and "Why this date?"
 * for the selected stage. The rail is forced at the static tier (reduced motion, save-data, in-app Reduce motion) and is
 * the default everywhere; 3D is an opt-in toggle and the choice is remembered per browser.
 */
export function ItemLifecycle({
  nodes,
  events,
  asOf,
  nextKey,
  issueDate,
  staleSince,
}: {
  nodes: TimelineNode[];
  events: TimelineEvent[];
  asOf: string;
  nextKey: string | undefined;
  issueDate: string;
  staleSince: string | null;
}) {
  const tier = useRenderTier();
  const pref = useSyncExternalStore(subscribe, readPref, () => "rail" as LifecycleView);
  const forcedFlat = tier === "static";
  const view: LifecycleView = forcedFlat ? "rail" : pref;
  const [selected, setSelected] = useState<string | null>(() => defaultWhyKey(nodes, nextKey));
  const node = nodes.find((n) => n.key === selected) ?? null;
  const stages = nodes.map((n) => ({ key: n.key, label: n.label, date: n.date, verified: n.verified, legal: n.legal, rulePath: n.rulePaths[0] ?? null }));
  const explainable = nodes.filter((n) => n.legal || n.date);

  return (
    <div className="space-y-4" data-testid="item-lifecycle" data-view={view}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <InstrumentLabel as="h3" id="lc-h">
          Lifecycle
        </InstrumentLabel>
        {forcedFlat ? (
          <span className="text-xs text-fg-3" data-testid="lifecycle-flat-note">
            Flat view while motion is reduced
          </span>
        ) : (
          <Segmented<LifecycleView> label="Lifecycle view" size="sm" value={view} onValueChange={writePref} options={VIEW_OPTIONS} />
        )}
      </div>

      {view === "3d" ? (
        <LifecycleTunnel stages={stages} asOf={asOf} nextKey={nextKey} selectedKey={selected} onSelect={setSelected} tier={tier} />
      ) : (
        <LifecycleRail title="Lifecycle" hideTitle variant="compact" issueDate={issueDate} staleSince={staleSince} asOf={asOf} events={events} />
      )}

      <section aria-labelledby="why-h" className="space-y-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="why-h" className="text-[13px] font-medium text-fg-1">
            Why this date?
          </h3>
          {node ? <span className="text-xs text-fg-3">{node.label}</span> : null}
        </div>
        {view === "rail" ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Explain a date">
            {explainable.map((n) => (
              <button
                key={n.key}
                type="button"
                aria-pressed={n.key === selected}
                onClick={() => setSelected(n.key)}
                data-testid="why-pick"
                className={cn(
                  "inline-flex h-7 items-center rounded-md border px-2 text-xs transition-colors duration-150",
                  n.key === selected ? "border-line-strong bg-ink-3 text-fg-1" : "border-line text-fg-2 hover:border-line-hover hover:text-fg-1",
                )}
              >
                {n.label}
              </button>
            ))}
          </div>
        ) : null}
        {node ? <WhyThisDate node={node} /> : <p className="text-[13px] text-fg-3">Pick a stage to see how its date was derived.</p>}
      </section>
    </div>
  );
}
