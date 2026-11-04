/**
 * The numbers a reseed must put back. One definition for `pnpm seed:demo` and the in-app Reset demo data button, so
 * the two cannot drift apart. Only meaningful at the default demo anchor date.
 */
export const DEMO_EXPECTED = { items: 47, totalCents: 6_191_500, byState: { CA: 21, TX: 15, DE: 11 } } as const;

export const formatDemoUsd = (cents: number): string => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

/** Problems with the reseeded numbers, empty when the demo invariants hold. */
export function demoInvariantProblems(s: { items: number; totalCents: number; byState: Record<string, number>; evalRuns?: number }): string[] {
  const problems: string[] = [];
  if (s.items !== DEMO_EXPECTED.items) problems.push(`expected ${DEMO_EXPECTED.items} stale items, got ${s.items}`);
  if (s.totalCents !== DEMO_EXPECTED.totalCents) problems.push(`expected ${formatDemoUsd(DEMO_EXPECTED.totalCents)}, got ${formatDemoUsd(s.totalCents)}`);
  for (const [st, n] of Object.entries(DEMO_EXPECTED.byState)) {
    if (s.byState[st] !== n) problems.push(`expected ${st}=${n}, got ${s.byState[st] ?? 0}`);
  }
  if (s.evalRuns !== undefined && s.evalRuns < 1) problems.push("expected a stored eval run, got none");
  return problems;
}
