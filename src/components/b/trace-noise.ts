import type { TraceStepView } from "./trace";

/** The dev server's HMR websocket is blocked by the replica fence in `next dev`; that is tooling noise, not agent work. */
const DEV_WS_RE = /\bws:\/\/[^\s]*\/_next\/(?:webpack-)?hmr/i;

export const isDevNoise = (s: Pick<TraceStepView, "kind" | "label">): boolean => s.kind === "guard_blocked" && DEV_WS_RE.test(s.label);

/** Folds every dev-server websocket block into one "dev_noise" row at the first occurrence. Real guard blocks stay. */
export function foldDevNoise(steps: TraceStepView[]): TraceStepView[] {
  const noise = steps.filter(isDevNoise);
  if (noise.length === 0) return steps;
  const first = noise[0]!;
  const folded: TraceStepView = {
    ...first,
    kind: "dev_noise",
    label: `${noise.length} dev-server (HMR) websocket connection${noise.length === 1 ? "" : "s"} blocked by the guard`,
    data: { count: noise.length, note: "Next dev hot-reload sockets; the replica fence closes them. Not agent activity." },
    screenshot: null,
    tone: "neutral",
  };
  return steps.flatMap((s) => (s === first ? [folded] : isDevNoise(s) ? [] : [s]));
}
