import type { Db } from "@/db/client";
import { recordSeedDryRun } from "./seed-run";
import { clockMutationAllowed, isDemoMode } from "@/lib/clock";

export { DEMO_EXPECTED, demoInvariantProblems } from "./expected";

export type ResetEnv = Record<string, string | undefined>;

/**
 * Why a demo reset must NOT run, or null when it may. It wipes approvals, filings and every app row, so it is allowed
 * only on the file-backed synthetic PGlite database in demo mode: never against Neon/DATABASE_URL, never outside demo
 * mode, and in production-like deployments only with an explicit DEMO_MODE=1.
 */
export function demoResetBlocker(env: ResetEnv = process.env): string | null {
  if (env.DATABASE_URL?.trim()) return "This app is connected to a hosted database, so resetting is turned off. Resetting only runs on the local synthetic demo database.";
  if (!isDemoMode(env)) return "Resetting demo data only works in demo mode (DEMO_MODE=1).";
  if (!clockMutationAllowed(env)) return "Resetting demo data is turned off in production unless DEMO_MODE=1 is set.";
  return null;
}

export class DemoResetBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoResetBlockedError";
  }
}

export interface DemoResetSummary {
  items: number;
  totalCents: number;
  byState: Record<string, number>;
  today: string;
  payees: number;
}

const g = globalThis as typeof globalThis & { __escheatDemoResetRunning?: boolean };

/**
 * Reseed the synthetic demo database in-process, through the one shared PGlite handle (a second process on the same
 * data directory would corrupt it, which is why this never shells out to `pnpm seed:demo`). One reset at a time.
 * The classifier is forced to the heuristic path for the duration, like the seed script, so no API credits are spent.
 * Skips the eval run (the CLI seed runs it; /eval keeps its last run).
 */
export async function resetDemoData(db: Db, env: ResetEnv = process.env): Promise<DemoResetSummary> {
  const blocked = demoResetBlocker(env);
  if (blocked) throw new DemoResetBlockedError(blocked);
  if (g.__escheatDemoResetRunning) throw new DemoResetBlockedError("A reset is already running.");
  g.__escheatDemoResetRunning = true;
  const savedKey = process.env.ANTHROPIC_API_KEY;
  const savedAnchor = process.env.DEMO_ANCHOR_DATE;
  try {
    process.env.ANTHROPIC_API_KEY = "";
    const [{ DEMO_ANCHOR_DATE }, { buildBundle }, { seedDemo }, { syncRulesToDb }, clock, { detectStaleItems }, { resolveCompanyId }] =
      await Promise.all([
        import("@/lib/synthetic/model"),
        import("@/lib/synthetic/build"),
        import("@/lib/synthetic/seed"),
        import("@/lib/rules/load"),
        import("@/lib/clock"),
        import("@/lib/pipeline/detect"),
        import("@/lib/pipeline/company"),
      ]);
    // The seeded numbers are defined at the demo anchor date; pin it while seeding when the server has none.
    process.env.DEMO_ANCHOR_DATE ||= DEMO_ANCHOR_DATE;
    const bundle = buildBundle();
    const counts = await seedDemo(db, bundle.dataset, [...bundle.generatedCases, ...bundle.adversarialCases]);
    const synced = await syncRulesToDb(db);
    const companyId = await resolveCompanyId(db);
    if (!companyId) throw new Error("seed produced no company");
    await clock.resetClock(db, companyId);
    const today = await clock.now(db, companyId);
    const stale = await detectStaleItems(db, companyId);
    const items = stale.inserted + stale.updated;
    await recordSeedDryRun(db, companyId, { rules: synced, items, totalCents: stale.totalCents, byState: stale.byState });
    return { items, totalCents: stale.totalCents, byState: stale.byState, today, payees: counts.payees };
  } finally {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
    if (savedAnchor === undefined) delete process.env.DEMO_ANCHOR_DATE;
    else process.env.DEMO_ANCHOR_DATE = savedAnchor;
    g.__escheatDemoResetRunning = false;
  }
}
