/**
 * What the human sees when approving a filing: the portal summary the agent extracted and the latest screenshot it
 * took, both read straight from the stored run trace. Nothing is synthesized; absent evidence is reported as null.
 */
export interface PortalEvidence {
  runId: string;
  summary: { itemCount: number; totalCents: number } | null;
  shot: { step: number; src: string; label: string } | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function portalEvidence(runId: string | null, trace: unknown): PortalEvidence | null {
  if (!runId) return null;
  const steps = Array.isArray(trace) ? trace : [];
  let summary: PortalEvidence["summary"] = null;
  let shot: PortalEvidence["shot"] = null;
  steps.forEach((s, step) => {
    if (!isObj(s)) return;
    const sm = isObj(s.data) && isObj(s.data.summary) ? s.data.summary : null;
    if (s.kind === "extract" && sm && typeof sm.itemCount === "number" && typeof sm.totalCents === "number") {
      summary = { itemCount: sm.itemCount, totalCents: sm.totalCents };
    }
    if (typeof s.screenshot === "string" && s.screenshot) {
      shot = { step, src: `/runs/${runId}/shots/${step}`, label: typeof s.message === "string" ? s.message : "Portal screenshot" };
    }
  });
  return { runId, summary, shot };
}
