"use client";

import { useSyncExternalStore } from "react";
import { Segmented } from "@/components/ui/segmented";
import { MOTION_CHANGE_EVENT, readMotionPref, setMotionPref, type MotionPref } from "@/components/viz/core/useRenderTier";

const OPTIONS = [
  { value: "system", label: "System" },
  { value: "reduce", label: "On" },
  { value: "on", label: "Off" },
] as const satisfies readonly { value: MotionPref; label: string }[];

function subscribe(cb: () => void): () => void {
  window.addEventListener(MOTION_CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(MOTION_CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

const HINT: Record<MotionPref, string> = {
  system: "Follows your device setting.",
  reduce: "Diagrams render fully drawn and nothing animates.",
  on: "Animations play. If your device asks for reduced motion, that still applies.",
};

/**
 * Preferences (§6.15): "Reduce motion" writes the same localStorage key (es-motion) the command palette toggles and
 * that useRenderTier / MotionRoot read, through the shared setMotionPref helper.
 */
export function Preferences() {
  const pref = useSyncExternalStore(subscribe, readMotionPref, () => "system" as MotionPref);
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3" data-testid="pref-reduce-motion" data-value={pref}>
      <div className="min-w-0 flex-1 basis-64">
        <h3 id="pref-motion-label" className="text-sm font-medium text-fg-1">
          Reduce motion
        </h3>
        <p className="mt-1 max-w-prose text-[13px] leading-5 text-fg-2">{HINT[pref]}</p>
      </div>
      <Segmented label="Reduce motion" value={pref} onValueChange={setMotionPref} options={OPTIONS} />
    </div>
  );
}
