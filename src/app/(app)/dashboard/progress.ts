const DAY_MS = 86_400_000;
const toDay = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

/**
 * Where "today" falls on a row of evenly spaced timeline nodes, as a fraction of the distance from the first node to
 * the last (0..1). Between two dated nodes it interpolates by calendar days; undated nodes are skipped (never
 * guessed). Before the first dated node it sits on that node, after the last it is 1. Fewer than two nodes: 0.
 */
export function progressToToday(dates: readonly (string | null)[], asOf: string): number {
  const n = dates.length;
  if (n < 2) return 0;
  const dated = dates.flatMap((d, i) => (d ? [{ i, t: toDay(d) }] : []));
  if (dated.length === 0) return 0;
  const now = toDay(asOf);
  const before = dated.filter((d) => d.t <= now);
  if (before.length === 0) return dated[0]!.i / (n - 1);
  const p = before[before.length - 1]!;
  const q = dated.find((d) => d.t > now);
  if (!q) return p.i / (n - 1);
  const frac = (now - p.t) / (q.t - p.t);
  return (p.i + (q.i - p.i) * frac) / (n - 1);
}
