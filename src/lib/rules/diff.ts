import type { RuleFile } from "../../../rules/schema";
import { listRuleValues } from "./values";

export type RuleChangeKind = "added" | "removed" | "changed" | "sources_only" | "verification_only";

export interface RuleFieldChange {
  path: string;
  kind: RuleChangeKind;
  before: unknown;
  after: unknown;
  beforeVerified: boolean | null;
  afterVerified: boolean | null;
  sourcesChanged: boolean;
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Field-level differences between two rule files, keyed by RuleValue path. Empty array = identical. */
export function diffRules(a: RuleFile, b: RuleFile): RuleFieldChange[] {
  const ma = new Map(listRuleValues(a).map((v) => [v.path, v.rv]));
  const mb = new Map(listRuleValues(b).map((v) => [v.path, v.rv]));
  const paths = [...new Set([...ma.keys(), ...mb.keys()])].sort();
  const out: RuleFieldChange[] = [];
  const srcKey = (rv: { sources: { url: string; quote: string }[] }) =>
    stable(rv.sources.map((s) => [s.url, s.quote]).sort());

  for (const path of paths) {
    const ra = ma.get(path);
    const rb = mb.get(path);
    if (!ra && rb) {
      out.push({ path, kind: "added", before: undefined, after: rb.value, beforeVerified: null, afterVerified: rb.verified, sourcesChanged: rb.sources.length > 0 });
      continue;
    }
    if (ra && !rb) {
      out.push({ path, kind: "removed", before: ra.value, after: undefined, beforeVerified: ra.verified, afterVerified: null, sourcesChanged: ra.sources.length > 0 });
      continue;
    }
    if (!ra || !rb) continue;
    const valueChanged = stable(ra.value) !== stable(rb.value);
    const sourcesChanged = srcKey(ra) !== srcKey(rb);
    const verifiedChanged = ra.verified !== rb.verified;
    if (!valueChanged && !sourcesChanged && !verifiedChanged) continue;
    out.push({
      path,
      kind: valueChanged ? "changed" : sourcesChanged ? "sources_only" : "verification_only",
      before: ra.value,
      after: rb.value,
      beforeVerified: ra.verified,
      afterVerified: rb.verified,
      sourcesChanged,
    });
  }
  if (a.state !== b.state) {
    out.push({ path: "state", kind: "changed", before: a.state, after: b.state, beforeVerified: null, afterVerified: null, sourcesChanged: false });
  }
  return out;
}
