/** Pure shaping of a stored eval run for display. Never invents a number: everything comes from eval_runs.metrics / eval_results. */
export const FIELD_LABEL = {
  property_type: "Property type",
  owner_state: "Owner state",
  owner_state_basis: "Why that state",
  is_stale: "Is stale",
} as const;
export type EvalFieldKey = keyof typeof FIELD_LABEL;
export const FIELD_KEYS = Object.keys(FIELD_LABEL) as EvalFieldKey[];

export interface FieldStat {
  correct: number;
  total: number;
  accuracy: number;
}
export interface SliceStats extends Partial<Record<EvalFieldKey, FieldStat>> {
  all_fields?: FieldStat;
}

export interface EvalMethod {
  kind: "heuristic" | "model" | "replay" | "unknown";
  label: string;
  detail: string;
}

export function describeMethod(mode: unknown, workerModel: string, orchestratorModel: string): EvalMethod {
  const m = typeof mode === "string" ? mode : "";
  if (m === "heuristic") {
    return {
      kind: "heuristic",
      label: "Heuristic baseline",
      detail: "No Anthropic key was configured, so these numbers measure a deterministic keyword baseline, not the model. Do not read them as model accuracy.",
    };
  }
  if (m === "model") {
    return { kind: "model", label: "Model", detail: `Classified by ${workerModel} with ${orchestratorModel} on review cases.` };
  }
  if (m.startsWith("replay")) {
    return { kind: "replay", label: "Replay", detail: "Offline replay of recorded model responses (cassettes), not a live model call." };
  }
  return { kind: "unknown", label: "Method not recorded", detail: "This run did not record how it classified the items." };
}

export interface EvalErrorRow {
  caseId: string;
  slice: string;
  field: EvalFieldKey;
  expected: unknown;
  actual: unknown;
}

export function errorRows(
  results: { pass: boolean; slice: string; itemSnapshot: Record<string, unknown>; expected: Record<string, unknown>; actual: Record<string, unknown> | null }[],
): EvalErrorRow[] {
  const out: EvalErrorRow[] = [];
  for (const r of results) {
    if (r.pass) continue;
    const caseId = String(r.itemSnapshot.caseId ?? "unknown");
    for (const f of FIELD_KEYS) {
      const exp = r.expected[f];
      const act = r.actual ? r.actual[f] : undefined;
      if (exp !== act) out.push({ caseId, slice: r.slice, field: f, expected: exp, actual: r.actual ? act : "classifier failed" });
    }
  }
  return out.sort((a, b) => a.caseId.localeCompare(b.caseId, undefined, { numeric: true }) || a.field.localeCompare(b.field));
}

export const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
