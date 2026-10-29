import { addressAgreement, type AddressParts } from "./address";
import { normalizeName, normalizeTokens } from "./normalize";
import { jaroWinkler } from "./similarity";

export interface PayeeInput extends AddressParts {
  id: string;
  name: string;
}

export type ClusterBasis = "exact" | "rule" | "model";

export interface PayeeCluster {
  canonicalName: string;
  aliases: string[]; // distinct raw names other than canonical
  members: PayeeInput[];
  basis: ClusterBasis;
  /** 0..100 */
  confidence: number;
}

export interface AmbiguousPair {
  a: PayeeInput;
  b: PayeeInput;
  score: number;
}

export interface ResolvedPair extends AmbiguousPair {
  same: boolean;
  confidence: number;
  rationale: string;
}

export interface ClusterResult {
  clusters: PayeeCluster[];
  /** Unresolved ambiguous pairs between different clusters (best-scoring pair per cluster pair). */
  ambiguous: AmbiguousPair[];
  /** Pairs a resolver ruled on (merged when same && confident). */
  resolved: ResolvedPair[];
}

export type PairResolver = (pair: AmbiguousPair) => Promise<{ same: boolean; confidence: number; rationale: string }>;

export interface ClusterOptions {
  /** Called only for ambiguous (0.80..0.95) pairs. Default: keep separate (no resolver). */
  resolver?: PairResolver;
  /** Minimum resolver confidence (0..1) to accept `same: true`. Default 0.8. */
  resolverMinConfidence?: number;
}

export const AUTO_MERGE_THRESHOLD = 0.95;
export const AMBIGUOUS_THRESHOLD = 0.8;
const ADDRESS_MATCH_BONUS = 0.04;
const ADDRESS_CONFLICT_PENALTY = 0.12;
const NUMERIC_MISMATCH_CAP = 0.79;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function nameSimilarity(ta: string[], tb: string[]): number {
  const a = ta.join(" ");
  const b = tb.join(" ");
  if (a === b) return 1;
  const sortedA = [...ta].sort().join(" ");
  const sortedB = [...tb].sort().join(" ");
  let score = Math.max(jaroWinkler(a, b), jaroWinkler(sortedA, sortedB));
  // "Plant 1" vs "Plant 2": differing numeric tokens are different payees.
  const numsA = ta.filter((t) => /\d/.test(t)).sort().join(",");
  const numsB = tb.filter((t) => /\d/.test(t)).sort().join(",");
  if (numsA !== numsB) score = Math.min(score, NUMERIC_MISMATCH_CAP);
  return score;
}

/** Final pair score: name similarity adjusted by address agreement. */
export function pairScore(a: PayeeInput, b: PayeeInput): number {
  const base = nameSimilarity(normalizeTokens(a.name), normalizeTokens(b.name));
  const agreement = addressAgreement(a, b);
  if (agreement === "match") return clamp01(base + ADDRESS_MATCH_BONUS);
  if (agreement === "conflict") return clamp01(base - ADDRESS_CONFLICT_PENALTY);
  return base;
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]!]!;
      i = this.parent[i]!;
    }
    return i;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

interface Edge {
  i: number;
  j: number;
  score: number;
  basis: ClusterBasis;
}

/** Candidate pairs: share a 2-char name prefix or the first 3 chars of the longest token. */
function candidatePairs(tokens: string[][]): Array<[number, number]> {
  const blocks = new Map<string, number[]>();
  const add = (key: string, i: number) => {
    if (!key) return;
    blocks.set(key, [...(blocks.get(key) ?? []), i]);
  };
  tokens.forEach((t, i) => {
    const joined = t.join(" ");
    add(`p:${joined.slice(0, 2)}`, i);
    const longest = [...t].sort((x, y) => y.length - x.length)[0] ?? "";
    add(`t:${longest.slice(0, 3)}`, i);
  });
  const seen = new Set<string>();
  const pairs: Array<[number, number]> = [];
  for (const members of blocks.values()) {
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) {
        const key = `${members[x]}:${members[y]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push([members[x]!, members[y]!]);
      }
    }
  }
  return pairs;
}

function pickCanonical(members: PayeeInput[]): string {
  const counts = new Map<string, number>();
  for (const m of members) counts.set(m.name.trim(), (counts.get(m.name.trim()) ?? 0) + 1);
  const isMixed = (s: string) => s !== s.toUpperCase() && s !== s.toLowerCase();
  // "clean" = nothing (suffix, abbreviation) would be rewritten by normalization
  const isClean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === normalizeName(s);
  return [...counts.entries()].sort(
    (a, b) =>
      b[1] - a[1] ||
      Number(isMixed(b[0])) - Number(isMixed(a[0])) ||
      Number(isClean(b[0])) - Number(isClean(a[0])) ||
      a[0].length - b[0].length ||
      a[0].localeCompare(b[0]),
  )[0]![0];
}

interface Analysis {
  inputs: PayeeInput[];
  edges: Edge[];
  /** best ambiguous pair as input indices, with score */
  ambiguous: Array<{ i: number; j: number; score: number }>;
}

function analyze(inputs: PayeeInput[]): Analysis {
  const tokens = inputs.map((p) => normalizeTokens(p.name));
  const keys = tokens.map((t) => t.join(" "));
  const edges: Edge[] = [];
  const ambiguous: Analysis["ambiguous"] = [];
  const consider = (i: number, j: number) => {
    const score = pairScore(inputs[i]!, inputs[j]!);
    if (score >= AUTO_MERGE_THRESHOLD) {
      edges.push({ i, j, score, basis: keys[i] === keys[j] ? "exact" : "rule" });
    } else if (score >= AMBIGUOUS_THRESHOLD) {
      ambiguous.push({ i, j, score });
    }
  };
  // exact normalized-name groups are always compared (cheap), then fuzzy candidates
  const byKey = new Map<string, number[]>();
  keys.forEach((k, i) => byKey.set(k, [...(byKey.get(k) ?? []), i]));
  const done = new Set<string>();
  for (const group of byKey.values()) {
    for (let x = 0; x < group.length; x++) {
      for (let y = x + 1; y < group.length; y++) {
        done.add(`${group[x]}:${group[y]}`);
        consider(group[x]!, group[y]!);
      }
    }
  }
  for (const [i, j] of candidatePairs(tokens)) if (!done.has(`${i}:${j}`)) consider(i, j);
  return { inputs, edges, ambiguous };
}

function buildClusters(
  inputs: PayeeInput[],
  uf: UnionFind,
  edges: Edge[],
): PayeeCluster[] {
  const groups = new Map<number, number[]>();
  inputs.forEach((_, i) => {
    const r = uf.find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  const rank: Record<ClusterBasis, number> = { exact: 0, rule: 1, model: 2 };
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([root, idxs]) => {
      const members = idxs.map((i) => inputs[i]!);
      const own = edges.filter((e) => uf.find(e.i) === root);
      const basis = own.reduce<ClusterBasis>((acc, e) => (rank[e.basis] > rank[acc] ? e.basis : acc), "exact");
      const confidence = own.length === 0 ? 100 : Math.round(Math.min(...own.map((e) => e.score)) * 100);
      const canonicalName = pickCanonical(members);
      const aliases = [...new Set(members.map((m) => m.name.trim()))].filter((n) => n !== canonicalName);
      return { canonicalName, aliases, members, basis, confidence };
    });
}

function groupAmbiguous(uf: UnionFind, inputs: PayeeInput[], amb: Analysis["ambiguous"]): AmbiguousPair[] {
  const best = new Map<string, { i: number; j: number; score: number }>();
  for (const p of amb) {
    const ra = uf.find(p.i);
    const rb = uf.find(p.j);
    if (ra === rb) continue;
    const key = ra < rb ? `${ra}:${rb}` : `${rb}:${ra}`;
    const cur = best.get(key);
    if (!cur || p.score > cur.score) best.set(key, p);
  }
  return [...best.values()]
    .sort((x, y) => y.score - x.score)
    .map((p) => ({ a: inputs[p.i]!, b: inputs[p.j]!, score: Math.round(p.score * 1000) / 1000 }));
}

/** Pure, synchronous clustering: normalized-exact and rule merges only; ambiguous pairs are reported. */
export function clusterPayeesSync(inputs: PayeeInput[]): ClusterResult {
  const { edges, ambiguous } = analyze(inputs);
  const uf = new UnionFind(inputs.length);
  for (const e of edges) uf.union(e.i, e.j);
  return {
    clusters: buildClusters(inputs, uf, edges),
    ambiguous: groupAmbiguous(uf, inputs, ambiguous),
    resolved: [],
  };
}

/**
 * Cluster payees. Ambiguous pairs (score 0.80-0.95) go to `opts.resolver` when given
 * (merging with basis 'model' when it says same with enough confidence); without a
 * resolver they stay separate and are returned in `ambiguous`.
 */
export async function clusterPayees(inputs: PayeeInput[], opts: ClusterOptions = {}): Promise<ClusterResult> {
  const { edges, ambiguous } = analyze(inputs);
  const uf = new UnionFind(inputs.length);
  for (const e of edges) uf.union(e.i, e.j);
  const indexById = new Map(inputs.map((p, i) => [p.id, i]));

  const resolved: ResolvedPair[] = [];
  let remaining = groupAmbiguous(uf, inputs, ambiguous);
  if (opts.resolver) {
    const minConf = opts.resolverMinConfidence ?? 0.8;
    const unresolved: AmbiguousPair[] = [];
    for (const pair of remaining) {
      const verdict = await opts.resolver(pair);
      resolved.push({ ...pair, ...verdict });
      const i = indexById.get(pair.a.id)!;
      const j = indexById.get(pair.b.id)!;
      if (verdict.same && verdict.confidence >= minConf) {
        uf.union(i, j);
        edges.push({ i, j, score: verdict.confidence, basis: "model" });
      }
    }
    // pairs can only be dropped once ruled on; recompute against the merged clusters
    const ruled = new Set(resolved.map((r) => `${r.a.id}|${r.b.id}`));
    for (const pair of groupAmbiguous(uf, inputs, ambiguous)) {
      if (!ruled.has(`${pair.a.id}|${pair.b.id}`)) unresolved.push(pair);
    }
    remaining = unresolved;
  }
  return { clusters: buildClusters(inputs, uf, edges), ambiguous: remaining, resolved };
}

export { normalizeName };
