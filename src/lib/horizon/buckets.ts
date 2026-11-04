/** "$X becomes stale in 30 / 60 / 90 days": disjoint buckets so they always sum to the worklist total. */

export interface StaleBucket {
  key: "d30" | "d60" | "d90" | "later";
  label: string;
  /** Inclusive day range for daysUntilStale; `to` null = open ended. */
  from: number;
  to: number | null;
  count: number;
  cents: number;
}

const DEFS: ReadonlyArray<Pick<StaleBucket, "key" | "label" | "from" | "to">> = [
  { key: "d30", label: "within 30 days", from: 0, to: 30 },
  { key: "d60", label: "in 31 to 60 days", from: 31, to: 60 },
  { key: "d90", label: "in 61 to 90 days", from: 61, to: 90 },
  { key: "later", label: "in more than 90 days", from: 91, to: null },
];

export interface BucketInput {
  daysUntilStale: number;
  amountCents: number;
}

export function bucketByDaysUntilStale(items: readonly BucketInput[]): StaleBucket[] {
  return DEFS.map((d) => {
    const hits = items.filter((i) => i.daysUntilStale >= d.from && (d.to === null || i.daysUntilStale <= d.to));
    return { ...d, count: hits.length, cents: hits.reduce((sum, i) => sum + i.amountCents, 0) };
  });
}

export const bucketsTotalCents = (buckets: readonly StaleBucket[]): number => buckets.reduce((s, b) => s + b.cents, 0);
