import { asc, notInArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companies, staleItems, type Company } from "@/db/schema";
import { now as clockNow } from "@/lib/clock";
import { compare, diffDays, type IsoDate } from "@/lib/dates";
import { formatUSD } from "@/lib/money";
import type { DeadlineKind, Money, StaleItemRow } from "./schemas";

/** Statuses that no longer count as owed: paid back to the owner, or already remitted to the state. */
export const CLOSED_STATUSES = ["resolved_paid", "remitted"] as const;
export const openStatusCondition = () => notInArray(staleItems.status, [...CLOSED_STATUSES]);

export const money = (cents: number): Money => ({ cents, formatted: formatUSD(cents) });

export async function getDefaultCompanyId(db: Db): Promise<string> {
  const [row] = await db.select({ id: companies.id }).from(companies).orderBy(asc(companies.createdAt)).limit(1);
  if (!row) throw new Error("No company found. Seed the demo data first: pnpm seed:demo");
  return row.id;
}

export async function getCompany(db: Db, companyId?: string): Promise<Company> {
  const rows = await db.select().from(companies).orderBy(asc(companies.createdAt));
  const row = companyId ? rows.find((c) => c.id === companyId) : rows[0];
  if (!row) throw new Error("Company not found. Seed the demo data first: pnpm seed:demo");
  return row;
}

/** The company's "today" (demo clock aware). */
export const today = (db: Db, companyId: string): Promise<IsoDate> => clockNow(db, companyId);

export interface DateColumns {
  ddWindowStart: string | null;
  ddWindowEnd: string | null;
  reportDueDate: string | null;
  remitDueDate: string | null;
}

export const DEADLINE_ORDER: Record<DeadlineKind, number> = { dd_window_start: 0, dd_window_end: 1, report_due: 2, remit_due: 3 };

export function deadlinesOf(c: DateColumns): { kind: DeadlineKind; date: IsoDate }[] {
  const all: [DeadlineKind, string | null][] = [
    ["dd_window_start", c.ddWindowStart],
    ["dd_window_end", c.ddWindowEnd],
    ["report_due", c.reportDueDate],
    ["remit_due", c.remitDueDate],
  ];
  return all.flatMap(([kind, d]) => (d ? [{ kind, date: d as IsoDate }] : []));
}

export function nextDeadline(c: DateColumns, todayDate: IsoDate, verified: boolean): StaleItemRow["nextDeadline"] {
  const upcoming = deadlinesOf(c)
    .filter((d) => compare(d.date, todayDate) >= 0)
    .sort((a, b) => compare(a.date, b.date) || DEADLINE_ORDER[a.kind] - DEADLINE_ORDER[b.kind]);
  const first = upcoming[0];
  return first ? { kind: first.kind, date: first.date, verified } : null;
}

export const ageDays = (issueDate: string, todayDate: IsoDate) => diffDays(issueDate as IsoDate, todayDate);

export function formatAddress(a: { addressLine?: string | null; city?: string | null; state?: string | null; zip?: string | null }): string {
  const tail = [a.state, a.zip].filter(Boolean).join(" ");
  return [a.addressLine, a.city, tail].filter((p) => p && String(p).trim()).join(", ");
}
