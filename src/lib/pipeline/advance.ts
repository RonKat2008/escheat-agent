/** Advance ONE item with the pure machine at the simulated today; used by the Inngest timeline loop. */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { staleItems, type StaleStatus } from "@/db/schema";
import * as clock from "@/lib/clock";
import { diffDays, type IsoDate } from "@/lib/dates";
import { TERMINAL_STATUSES, applyActions, decideStatus } from "./compute";

export interface AdvanceResult {
  found: boolean;
  status: StaleStatus | null;
  today: string | null;
  nextWakeAt: string | null;
  terminal: boolean;
  changed: boolean;
}

export async function advanceItem(db: Db, staleItemId: string): Promise<AdvanceResult> {
  const [row] = await db.select().from(staleItems).where(eq(staleItems.id, staleItemId));
  if (!row) return { found: false, status: null, today: null, nextWakeAt: null, terminal: true, changed: false };
  const today = await clock.now(db, row.companyId);
  if (TERMINAL_STATUSES.has(row.status)) {
    return { found: true, status: row.status, today, nextWakeAt: null, terminal: true, changed: false };
  }
  const ddApplies = (row.classification as { timeline?: { ddApplies?: boolean | null } } | null)?.timeline?.ddApplies ?? null;
  const r = decideStatus(row, ddApplies, today);
  if (r.status !== row.status) {
    await db.update(staleItems).set({ status: r.status }).where(eq(staleItems.id, row.id));
  }
  await applyActions(db, row, r.actions);
  return {
    found: true,
    status: r.status,
    today,
    nextWakeAt: r.nextWakeAt,
    terminal: TERMINAL_STATUSES.has(r.status),
    changed: r.status !== row.status,
  };
}

const DAY_MS = 86_400_000;
export const MAX_WAIT_MS = 30 * DAY_MS;
export const MIN_WAIT_MS = 60_000;

/** Real-time wait until the simulated wake date, clamped to [1 min, 30 d]. null wake => the cap. */
export function waitTimeoutMs(today: string, nextWakeAt: string | null): number {
  if (!nextWakeAt) return MAX_WAIT_MS;
  const ms = diffDays(today as IsoDate, nextWakeAt as IsoDate) * DAY_MS;
  return Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, ms));
}
