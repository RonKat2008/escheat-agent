import type { Db } from "@/db/client";
import { addDays, compare, diffDays, type IsoDate } from "@/lib/dates";
import { DEADLINE_ORDER, deadlinesOf, money, today } from "./common";
import { loadOpenRows } from "./items";
import type { DeadlineEvent } from "./schemas";

/** Deadline events in [today, today + days] (both ends inclusive), sorted by date then kind. */
export async function upcomingDeadlines(db: Db, companyId: string, days = 90): Promise<{ asOf: IsoDate; days: number; events: DeadlineEvent[] }> {
  const asOf = await today(db, companyId);
  const end = addDays(asOf, days);
  const rows = await loadOpenRows(db, companyId);
  const events: DeadlineEvent[] = [];
  for (const r of rows) {
    for (const d of deadlinesOf(r)) {
      if (compare(d.date, asOf) < 0 || compare(d.date, end) > 0) continue;
      events.push({
        date: d.date,
        kind: d.kind,
        daysUntil: diffDays(asOf, d.date),
        verified: !r.dependsOnUnverified,
        itemId: r.id,
        checkNumber: r.checkNumber ?? null,
        payeeName: r.payeeName ?? r.payeeNameRaw,
        state: r.ownerState ?? null,
        amount: money(r.amountCents),
        status: r.status,
      });
    }
  }
  events.sort((a, b) => compare(a.date as IsoDate, b.date as IsoDate) || DEADLINE_ORDER[a.kind] - DEADLINE_ORDER[b.kind] || a.itemId.localeCompare(b.itemId));
  return { asOf, days, events };
}
