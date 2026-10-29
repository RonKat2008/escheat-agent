/**
 * Demo clock. In demo mode "today" is DEMO_ANCHOR_DATE (default 2026-11-01) plus sim_clock.offset_days for
 * the company; otherwise it is the real UTC date plus the same offset. Everything time-driven (machine,
 * dashboards, Inngest wake-ups) must call now() instead of new Date().
 *
 * Demo mode is on when DEMO_MODE is "1"/"true", or when DEMO_ANCHOR_DATE is set. Pass `demo` to override.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { simClock } from "@/db/schema";
import { addDays, isIsoDate, todayUtc, type IsoDate } from "./dates";

export const DEFAULT_DEMO_ANCHOR: IsoDate = "2026-11-01" as IsoDate;

export interface ClockOptions {
  demo?: boolean;
  anchor?: string;
  /** Override "real today" (tests). */
  realToday?: IsoDate;
}

/** Pure: anchor + offset days. */
export function simulatedToday(anchor: IsoDate, offsetDays: number): IsoDate {
  return addDays(anchor, offsetDays);
}

export function isDemoMode(env: Record<string, string | undefined> = process.env): boolean {
  const flag = env.DEMO_MODE?.trim().toLowerCase();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return Boolean(env.DEMO_ANCHOR_DATE?.trim());
}

export function demoAnchor(env: Record<string, string | undefined> = process.env): IsoDate {
  const v = env.DEMO_ANCHOR_DATE?.trim();
  return v && isIsoDate(v) ? v : DEFAULT_DEMO_ANCHOR;
}

export async function getOffsetDays(db: Db, companyId: string): Promise<number> {
  const [row] = await db.select().from(simClock).where(eq(simClock.companyId, companyId));
  return row?.offsetDays ?? 0;
}

/** The company's current "today" as YYYY-MM-DD. */
export async function now(db: Db, companyId: string, opts: ClockOptions = {}): Promise<IsoDate> {
  const offset = await getOffsetDays(db, companyId);
  const demo = opts.demo ?? isDemoMode();
  const base = demo
    ? opts.anchor !== undefined && isIsoDate(opts.anchor)
      ? opts.anchor
      : demoAnchor()
    : (opts.realToday ?? todayUtc());
  return simulatedToday(base, offset);
}

/** Move the company's clock forward (or back, with a negative number). Returns the new offset. */
export async function advanceClock(db: Db, companyId: string, days: number): Promise<number> {
  if (!Number.isInteger(days)) throw new RangeError("days must be an integer");
  const next = (await getOffsetDays(db, companyId)) + days;
  await db
    .insert(simClock)
    .values({ companyId, offsetDays: next })
    .onConflictDoUpdate({ target: simClock.companyId, set: { offsetDays: next, updatedAt: new Date() } });
  return next;
}

export async function resetClock(db: Db, companyId: string): Promise<void> {
  await db
    .insert(simClock)
    .values({ companyId, offsetDays: 0 })
    .onConflictDoUpdate({ target: simClock.companyId, set: { offsetDays: 0, updatedAt: new Date() } });
}
