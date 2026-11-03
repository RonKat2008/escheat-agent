/** Pure scale helpers. No d3. */

export interface LinearScale {
  (v: number): number;
  invert: (px: number) => number;
  ticks: (count?: number) => number[];
  domain: readonly [number, number];
  range: readonly [number, number];
}

export function scaleLinear(domain: readonly [number, number], range: readonly [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const fn = ((v: number) => (span === 0 ? r0 : r0 + ((v - d0) / span) * (r1 - r0))) as LinearScale;
  fn.invert = (px: number) => (r1 === r0 ? d0 : d0 + ((px - r0) / (r1 - r0)) * span);
  fn.ticks = (count = 5) => niceTicks(d0, d1, count);
  fn.domain = domain;
  fn.range = range;
  return fn;
}

/** "Nice" round tick values within [a, b]. */
export function niceTicks(a: number, b: number, count = 5): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (lo === hi || count < 1) return [lo];
  const raw = (hi - lo) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const err = raw / pow;
  const step = pow * (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1);
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) {
    out.push(Math.round(t / step) * step);
  }
  return out;
}

const MS_PER_DAY = 86_400_000;

/** Days since epoch for a YYYY-MM-DD string (UTC). NaN when malformed. */
export function dayNumber(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return Number.NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY;
}

export function isoFromDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is earlier). */
export function daysBetween(fromIso: string, toIso: string): number {
  return dayNumber(toIso) - dayNumber(fromIso);
}

export interface TimeScale {
  (iso: string): number;
  invert: (px: number) => string;
  ticks: (count?: number) => string[];
  domain: readonly [string, string];
  range: readonly [number, number];
}

export function scaleTime(domain: readonly [string, string], range: readonly [number, number]): TimeScale {
  const lin = scaleLinear([dayNumber(domain[0]), dayNumber(domain[1])], range);
  const fn = ((iso: string) => lin(dayNumber(iso))) as TimeScale;
  fn.invert = (px: number) => isoFromDay(Math.round(lin.invert(px)));
  fn.ticks = (count = 5) => {
    const [d0, d1] = lin.domain;
    if (d0 === d1) return [isoFromDay(d0)];
    const n = Math.max(1, count);
    return Array.from({ length: n + 1 }, (_, i) => isoFromDay(Math.round(d0 + ((d1 - d0) * i) / n)));
  };
  fn.domain = domain;
  fn.range = range;
  return fn;
}

export interface BandScale {
  (key: string): number;
  bandwidth: number;
  step: number;
  keys: readonly string[];
}

/** Each key owns `step = width / n`; `padding` (0..1) is the share of the step left empty. */
export function scaleBand(
  keys: readonly string[],
  range: readonly [number, number],
  opts: { padding?: number } = {},
): BandScale {
  const padding = Math.min(Math.max(opts.padding ?? 0, 0), 0.99);
  const n = keys.length;
  const [r0, r1] = range;
  const step = n === 0 ? 0 : (r1 - r0) / n;
  const index = new Map(keys.map((k, i) => [k, i] as const));
  const fn = ((key: string) => {
    const i = index.get(key);
    return i === undefined ? Number.NaN : r0 + step * i + (step * padding) / 2;
  }) as BandScale;
  fn.bandwidth = step * (1 - padding);
  fn.step = step;
  fn.keys = keys;
  return fn;
}
