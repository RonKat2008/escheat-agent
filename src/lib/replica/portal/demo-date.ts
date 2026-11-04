import type { Db } from "@/db/client";
import { now } from "@/lib/clock";
import { todayUtc, type IsoDate } from "@/lib/dates";
import { getDefaultCompanyId } from "@/lib/queries";
import { onDemoCalendar } from "@/lib/clock-display";

/** The demo company's "today" (R6-12). The replica has no session company, so it uses the single seeded holder. */
export async function replicaToday(db: Db): Promise<IsoDate> {
  try {
    return await now(db, await getDefaultCompanyId(db));
  } catch {
    return todayUtc();
  }
}

/**
 * The day a filing is shown as made: the demo date recorded at submit time, else the real timestamp
 * clamped so it never reads as a day that has not happened on the demo clock.
 */
export function filedDay(row: { submittedAt: Date | null; parsedSummary: Record<string, unknown> | null }, today: string): string | null {
  const stored = row.parsedSummary?.filedOn;
  if (typeof stored === "string" && /^\d{4}-\d{2}-\d{2}$/.test(stored)) return stored;
  return onDemoCalendar(row.submittedAt?.toISOString(), today);
}
