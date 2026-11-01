import type { ClosePlan, CloseStepId } from "@/lib/chat/ui-types";

/** Step ids whose status differs between two plans (drives the one-shot "changed" highlight). */
export function changedSteps(prev: ClosePlan | null, next: ClosePlan): Set<CloseStepId> {
  if (!prev) return new Set();
  const before = new Map(prev.steps.map((s) => [s.id, s.status]));
  return new Set(next.steps.filter((s) => before.get(s.id) !== s.status).map((s) => s.id));
}
