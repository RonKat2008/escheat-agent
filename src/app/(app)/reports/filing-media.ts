/**
 * The filing agent's own recordings for the report's File step: every screenshot it stored on a trace step and the
 * session video it recorded, read straight from the run row. Pure. Absent media stays absent (nothing synthesized).
 * Files are served by /runs/[id]/shots/[step] and /reports/runs/[id]/video, which only read inside the run's folder.
 */

export interface FilingShot {
  step: number;
  src: string;
  label: string;
}

export interface FilingMedia {
  runId: string;
  shots: FilingShot[];
  video: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const MAX_SHOTS = 6;

export function filingMedia(runId: string | null, trace: unknown, output: unknown, max = MAX_SHOTS): FilingMedia | null {
  if (!runId) return null;
  const steps = Array.isArray(trace) ? trace : [];
  const shots: FilingShot[] = [];
  steps.forEach((s, step) => {
    if (!isObj(s) || typeof s.screenshot !== "string" || !s.screenshot.toLowerCase().endsWith(".png")) return;
    shots.push({ step, src: `/runs/${runId}/shots/${step}`, label: typeof s.message === "string" && s.message ? s.message : `Step ${step + 1}` });
  });
  const video = isObj(output) && typeof output.video === "string" && output.video.toLowerCase().endsWith(".webm") ? `/reports/runs/${runId}/video` : null;
  if (shots.length === 0 && !video) return null;
  return { runId, shots: shots.slice(-max), video };
}
