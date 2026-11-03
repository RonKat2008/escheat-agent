import type { ClosePlan, CloseStep, CloseStepId } from "@/lib/chat/ui-types";

/** Step ids whose status differs between two plans (drives the one-shot "changed" highlight). */
export function changedSteps(prev: ClosePlan | null, next: ClosePlan): Set<CloseStepId> {
  if (!prev) return new Set();
  const before = new Map(prev.steps.map((s) => [s.id, s.status]));
  return new Set(next.steps.filter((s) => before.get(s.id) !== s.status).map((s) => s.id));
}

/** Approvals queue filter per step: the letters a step is about. */
const APPROVAL_KIND: Partial<Record<CloseStepId, string>> = { letters_approve: "letter", letters_send: "letter" };

/**
 * Where a step's link takes the person: the page that does that step, pre-filtered to this state (and kind).
 * The plan's own href wins when it already points at one thing (a run, a selected approval); a page link gets the
 * state (and, for Approvals, the kind) added when it does not carry them yet.
 */
export function closeStepHref(step: Pick<CloseStep, "id" | "href">, state: string): string {
  const [path = "/", query = ""] = step.href.split("?");
  const params = new URLSearchParams(query);
  if (params.has("sel") || path.startsWith("/runs/")) return step.href;
  const kind = path === "/approvals" ? APPROVAL_KIND[step.id] : undefined;
  if (kind && !params.has("kind")) params.set("kind", kind);
  if (!params.has("state")) params.set("state", state.toUpperCase());
  return `${path}?${params.toString()}`;
}
