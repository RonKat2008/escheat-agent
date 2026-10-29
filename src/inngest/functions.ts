import { getDb } from "@/db/client";
import { companies } from "@/db/schema";
import { advanceItem, waitTimeoutMs } from "@/lib/pipeline/advance";
import { recomputeTimelines } from "@/lib/pipeline/recompute";
import { inngest } from "./client";
import { clockAdvanced, helloRequested, itemStaleCreated, ownerResponded } from "./events";

/** Placeholder to prove the Inngest wiring end to end. */
export const hello = inngest.createFunction(
  { id: "hello", triggers: [helloRequested] },
  async ({ event, step }) => {
    const message = await step.run("compose", () => `Hello, ${event.data.name}.`);
    return { message };
  },
);

/** Safety bound on loop iterations per run (each iteration is one wake-up). */
export const MAX_TIMELINE_ITERATIONS = 200;

/**
 * Durable per-item timeline. Thin: every decision is in advanceItem (pure machine + DB).
 * Loop: advance -> stop if terminal -> wait for clock/advanced OR owner/responded (real timeout until the
 * next wake date, capped at 30 d) -> repeat. Cancelled by item/resolved.
 */
export const itemTimeline = inngest.createFunction(
  {
    id: "item-timeline",
    triggers: [itemStaleCreated],
    cancelOn: [{ event: "item/resolved", match: "data.staleItemId" }],
  },
  async ({ event, step, group }) => {
    const { staleItemId, companyId } = event.data;
    let last: Awaited<ReturnType<typeof advanceItem>> | null = null;
    let iterations = 0;
    for (let i = 0; i < MAX_TIMELINE_ITERATIONS; i++) {
      iterations++;
      last = await step.run(`advance-${i}`, async () => advanceItem(await getDb(), staleItemId));
      if (last.terminal || !last.found) break;
      const timeout = waitTimeoutMs(last.today ?? "", last.nextWakeAt);
      await group.parallel(async () =>
        Promise.race([
          step.waitForEvent(`wait-clock-${i}`, { event: clockAdvanced, timeout, match: "data.companyId" }),
          step.waitForEvent(`wait-owner-${i}`, { event: ownerResponded, timeout, match: "data.staleItemId" }),
        ]),
      );
    }
    return { staleItemId, companyId, status: last?.status ?? null, iterations };
  },
);

/** Daily: re-run every company's timelines against the current rule versions. */
export const rulesRecompute = inngest.createFunction(
  { id: "rules-recompute", triggers: [{ cron: "TZ=UTC 0 6 * * *" }] },
  async ({ step }) => {
    const ids = await step.run("list-companies", async () => {
      const db = await getDb();
      return (await db.select({ id: companies.id }).from(companies)).map((c) => c.id);
    });
    const results: Array<{ companyId: string; processed: number; moved: number }> = [];
    for (const companyId of ids) {
      results.push(
        await step.run(`recompute-${companyId}`, async () => {
          const r = await recomputeTimelines(await getDb(), companyId);
          return { companyId, processed: r.processed, moved: r.deadlinesMoved };
        }),
      );
    }
    return results;
  },
);

export const functions = [hello, itemTimeline, rulesRecompute];
