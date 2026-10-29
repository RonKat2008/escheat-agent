export const EVAL_FIELDS = ["property_type", "owner_state", "owner_state_basis", "is_stale"] as const;
export type EvalField = (typeof EVAL_FIELDS)[number];

export interface EvalExpected {
  property_type: string;
  owner_state: string;
  owner_state_basis: string;
  is_stale: boolean;
}

export interface EvalCaseLite {
  id: string;
  slice: string;
  expected: EvalExpected;
}

/** actual === null means the classifier failed for this case (counted wrong on every field). */
export type EvalActual = (EvalExpected & { method?: string }) | null;

export interface FieldScore {
  correct: number;
  total: number;
  accuracy: number;
}

export interface EvalError {
  id: string;
  slice: string;
  field: EvalField | "error";
  expected: unknown;
  actual: unknown;
}

export interface EvalScore {
  overall: Record<EvalField, FieldScore> & { all_fields: FieldScore };
  bySlice: Record<string, Record<EvalField, FieldScore> & { all_fields: FieldScore }>;
  errors: EvalError[];
  passByCase: Record<string, boolean>;
}

type Tally = Record<EvalField | "all_fields", { correct: number; total: number }>;
const emptyTally = (): Tally => ({
  property_type: { correct: 0, total: 0 },
  owner_state: { correct: 0, total: 0 },
  owner_state_basis: { correct: 0, total: 0 },
  is_stale: { correct: 0, total: 0 },
  all_fields: { correct: 0, total: 0 },
});

function finish(t: Tally): Record<EvalField, FieldScore> & { all_fields: FieldScore } {
  const f = (x: { correct: number; total: number }): FieldScore => ({
    ...x,
    accuracy: x.total === 0 ? 0 : x.correct / x.total,
  });
  return {
    property_type: f(t.property_type),
    owner_state: f(t.owner_state),
    owner_state_basis: f(t.owner_state_basis),
    is_stale: f(t.is_stale),
    all_fields: f(t.all_fields),
  };
}

/** Pure scoring: per-field accuracy per slice and overall, plus every error. */
export function scoreEval(cases: readonly EvalCaseLite[], results: ReadonlyMap<string, EvalActual>): EvalScore {
  const overall = emptyTally();
  const slices = new Map<string, Tally>();
  const errors: EvalError[] = [];
  const passByCase: Record<string, boolean> = {};

  for (const c of cases) {
    const actual = results.get(c.id) ?? null;
    const sliceTally = slices.get(c.slice) ?? emptyTally();
    slices.set(c.slice, sliceTally);
    let allCorrect = true;
    if (actual === null) {
      errors.push({ id: c.id, slice: c.slice, field: "error", expected: c.expected, actual: null });
    }
    for (const field of EVAL_FIELDS) {
      const ok = actual !== null && actual[field] === c.expected[field];
      for (const t of [overall, sliceTally]) {
        t[field].total += 1;
        if (ok) t[field].correct += 1;
      }
      if (!ok) {
        allCorrect = false;
        if (actual !== null) {
          errors.push({ id: c.id, slice: c.slice, field, expected: c.expected[field], actual: actual[field] });
        }
      }
    }
    for (const t of [overall, sliceTally]) {
      t.all_fields.total += 1;
      if (allCorrect) t.all_fields.correct += 1;
    }
    passByCase[c.id] = allCorrect;
  }

  return {
    overall: finish(overall),
    bySlice: Object.fromEntries([...slices].map(([k, v]) => [k, finish(v)])),
    errors,
    passByCase,
  };
}
