/**
 * Read model for overdue obligations (R2-02): every open item run through the shared, pure `assessPersisted`
 * (src/lib/overdue.ts) against the company's demo-clock today. The dates are the engine's persisted output; nothing
 * here computes a legal date. Deliberately separate from StaleItemRow / DeadlineEvent so the chat tools' outputs (and
 * their recorded cassettes) stay unchanged.
 */
import type { Db } from "@/db/client";
import type { IsoDate } from "@/lib/dates";
import { assessPersisted, type OverdueObligation } from "@/lib/overdue";
import { money, today } from "./common";
import { loadOpenRows } from "./items";
import type { Money, StaleItemRow } from "./schemas";

export interface OverdueItem {
  itemId: string;
  checkNumber: string | null;
  payeeName: string;
  state: string | null;
  amount: Money;
  status: StaleItemRow["status"];
  earliest: OverdueObligation;
  overdue: OverdueObligation[];
  daysLate: number;
  verified: boolean;
}

/** Per-item flag for tables: overdue (with its earliest missed date) or a pending date that is unknown. */
export type OverdueFlag = { state: "overdue"; earliest: OverdueObligation; verified: boolean } | { state: "date_unknown" };

export interface OverdueSummary {
  asOf: IsoDate;
  count: number;
  total: Money;
  /** Every overdue item rests on verified rule values. */
  verified: boolean;
  byState: { state: string; count: number; cents: number }[];
  /** Most days late first. */
  items: OverdueItem[];
  /** Open items with a pending date the engine could not compute (never counted as overdue). */
  unknownCount: number;
  flags: Record<string, OverdueFlag>;
}

export async function getOverdue(db: Db, companyId: string, opts: { states?: readonly string[] } = {}): Promise<OverdueSummary> {
  const [asOf, all] = await Promise.all([today(db, companyId), loadOpenRows(db, companyId)]);
  const scope = new Set((opts.states ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean));
  const rows = scope.size === 0 ? all : all.filter((r) => r.ownerState !== null && scope.has(r.ownerState.toUpperCase()));
  const items: OverdueItem[] = [];
  const flags: Record<string, OverdueFlag> = {};
  let unknownCount = 0;
  for (const r of rows) {
    const a = assessPersisted(r, asOf);
    if (a.state === "date_unknown") {
      unknownCount += 1;
      flags[r.id] = { state: "date_unknown" };
    }
    if (a.state !== "overdue" || !a.earliest) continue;
    flags[r.id] = { state: "overdue", earliest: a.earliest, verified: a.verified };
    items.push({
      itemId: r.id,
      checkNumber: r.checkNumber,
      payeeName: r.payeeName ?? r.payeeNameRaw,
      state: r.ownerState,
      amount: money(r.amountCents),
      status: r.status,
      earliest: a.earliest,
      overdue: a.overdue,
      daysLate: a.daysLate,
      verified: a.verified,
    });
  }
  items.sort((a, b) => b.daysLate - a.daysLate || b.amount.cents - a.amount.cents || a.itemId.localeCompare(b.itemId));
  const byStateMap = new Map<string, { state: string; count: number; cents: number }>();
  for (const i of items) {
    const k = i.state ?? "Unknown";
    const prev = byStateMap.get(k) ?? { state: k, count: 0, cents: 0 };
    byStateMap.set(k, { ...prev, count: prev.count + 1, cents: prev.cents + i.amount.cents });
  }
  const cents = items.reduce((a, i) => a + i.amount.cents, 0);
  return {
    asOf,
    count: items.length,
    total: money(cents),
    verified: items.every((i) => i.verified),
    byState: [...byStateMap.values()].sort((a, b) => a.state.localeCompare(b.state)),
    items,
    unknownCount,
    flags,
  };
}
