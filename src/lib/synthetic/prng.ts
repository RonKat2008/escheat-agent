/** Deterministic PRNG (mulberry32) and helpers. SYNTHETIC data generation only. */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  /** Returns a new shuffled array (Fisher-Yates); input is not mutated. */
  shuffle<T>(items: readonly T[]): T[];
  /** Log-uniform float in [min, max]. */
  logUniform(min: number, max: number): number;
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
}

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashLabel(label: string): number {
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed: number, label = ""): Rng {
  const raw = mulberry32((seed ^ hashLabel(label)) >>> 0);
  const int = (min: number, max: number) => min + Math.floor(raw() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => {
    const v = items[int(0, items.length - 1)];
    if (v === undefined) throw new Error("pick from empty list");
    return v;
  };
  return {
    next: raw,
    int,
    pick,
    chance: (p) => raw() < p,
    shuffle: <T>(items: readonly T[]) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        const a = out[i] as T;
        out[i] = out[j] as T;
        out[j] = a;
      }
      return out;
    },
    logUniform: (min, max) => Math.exp(Math.log(min) + raw() * (Math.log(max) - Math.log(min))),
    weighted: <T>(items: readonly T[], weights: readonly number[]): T => {
      const total = weights.reduce((s, w) => s + w, 0);
      let r = raw() * total;
      for (let i = 0; i < items.length; i++) {
        r -= weights[i] ?? 0;
        if (r < 0) return items[i] as T;
      }
      return items[items.length - 1] as T;
    },
  };
}
