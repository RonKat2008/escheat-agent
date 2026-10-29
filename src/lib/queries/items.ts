import { and, asc, count, desc, eq, gte, ilike, lte, or, sql, sum, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { ledgerItems, payees, staleItems } from "@/db/schema";
import { addDays, type IsoDate } from "@/lib/dates";
import {
  ageDays,
  CLOSED_STATUSES,
  money,
  nextDeadline,
  openStatusCondition,
  today,
} from "./common";
import { ListFiltersSchema, type ListFilters, type StaleItemList, type StaleItemRow } from "./schemas";

const selection = {
  id: staleItems.id,
  ledgerItemId: staleItems.ledgerItemId,
  payeeName: payees.canonicalName,
  payeeNameRaw: ledgerItems.payeeNameRaw,
  checkNumber: ledgerItems.referenceNumber,
  propertyType: staleItems.propertyType,
  amountCents: staleItems.amountCents,
  issueDate: ledgerItems.issueDate,
  ownerState: staleItems.ownerState,
  ownerStateBasis: staleItems.ownerStateBasis,
  status: staleItems.status,
  classification: staleItems.classification,
  dependsOnUnverified: staleItems.dependsOnUnverified,
  ruleVersion: staleItems.ruleVersion,
  ddWindowStart: staleItems.ddWindowStart,
  ddWindowEnd: staleItems.ddWindowEnd,
  reportDueDate: staleItems.reportDueDate,
  remitDueDate: staleItems.remitDueDate,
};
export interface ItemSelectRow {
  id: string;
  ledgerItemId: string;
  payeeName: string | null;
  payeeNameRaw: string;
  checkNumber: string | null;
  propertyType: StaleItemRow["propertyType"];
  amountCents: number;
  issueDate: string;
  ownerState: string | null;
  ownerStateBasis: StaleItemRow["ownerStateBasis"];
  status: StaleItemRow["status"];
  classification: Record<string, unknown> | null;
  dependsOnUnverified: boolean;
  ruleVersion: string | null;
  ddWindowStart: string | null;
  ddWindowEnd: string | null;
  reportDueDate: string | null;
  remitDueDate: string | null;
}

/** Items the pipeline (or classifier) flagged for a human look. */
const needsReviewSql = sql`(${staleItems.status} = 'needs_rule' or ${staleItems.classification}->>'needs_review' = 'true')`;

export function toRow(x: ItemSelectRow, todayDate: IsoDate): StaleItemRow {
  const needsReview = x.status === "needs_rule" || x.classification?.needs_review === true;
  return {
    id: x.id,
    ledgerItemId: x.ledgerItemId,
    payeeName: x.payeeName ?? x.payeeNameRaw,
    payeeNameRaw: x.payeeNameRaw,
    checkNumber: x.checkNumber,
    propertyType: x.propertyType,
    amount: money(x.amountCents),
    issueDate: x.issueDate,
    ageDays: ageDays(x.issueDate, todayDate),
    ownerState: x.ownerState,
    ownerStateBasis: x.ownerStateBasis,
    status: x.status,
    needsReview,
    dependsOnUnverified: x.dependsOnUnverified,
    ruleVersion: x.ruleVersion,
    nextDeadline: nextDeadline(x, todayDate, !x.dependsOnUnverified),
  };
}

function buildWhere(companyId: string, f: ReturnType<typeof ListFiltersSchema.parse>, todayDate: IsoDate): SQL {
  const conds: (SQL | undefined)[] = [eq(staleItems.companyId, companyId)];
  if (!f.includeClosed) conds.push(openStatusCondition());
  if (f.state) conds.push(eq(staleItems.ownerState, f.state.toUpperCase()));
  if (f.status) conds.push(eq(staleItems.status, f.status));
  if (f.propertyType) conds.push(eq(staleItems.propertyType, f.propertyType));
  if (f.minAgeDays !== undefined) conds.push(lte(ledgerItems.issueDate, addDays(todayDate, -f.minAgeDays)));
  if (f.maxAgeDays !== undefined) conds.push(gte(ledgerItems.issueDate, addDays(todayDate, -f.maxAgeDays)));
  if (f.needsReview !== undefined) conds.push(f.needsReview ? needsReviewSql : sql`not ${needsReviewSql}`);
  const q = f.search?.trim();
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    conds.push(
      or(ilike(payees.canonicalName, like), ilike(ledgerItems.payeeNameRaw, like), ilike(ledgerItems.referenceNumber, like)),
    );
  }
  return and(...conds) as SQL;
}

function orderBy(sort: ReturnType<typeof ListFiltersSchema.parse>["sort"]): SQL[] {
  const payeeSort = sql`coalesce(${payees.canonicalName}, ${ledgerItems.payeeNameRaw})`;
  switch (sort) {
    case "age_asc":
      return [desc(ledgerItems.issueDate), asc(staleItems.id)];
    case "amount_desc":
      return [desc(staleItems.amountCents), asc(staleItems.id)];
    case "amount_asc":
      return [asc(staleItems.amountCents), asc(staleItems.id)];
    case "payee_asc":
      return [asc(payeeSort), asc(staleItems.id)];
    case "deadline_asc":
      return [
        asc(sql`least(${staleItems.ddWindowStart}, ${staleItems.ddWindowEnd}, ${staleItems.reportDueDate}, ${staleItems.remitDueDate}) nulls last`),
        asc(staleItems.id),
      ];
    default:
      return [asc(ledgerItems.issueDate), asc(staleItems.id)];
  }
}

const base = (db: Db) =>
  db
    .select(selection)
    .from(staleItems)
    .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
    .leftJoin(payees, eq(payees.id, staleItems.ownerPayeeId));

export async function listStaleItems(db: Db, companyId: string, filters: ListFilters = {}): Promise<StaleItemList> {
  const f = ListFiltersSchema.parse(filters);
  const todayDate = await today(db, companyId);
  const where = buildWhere(companyId, f, todayDate);
  const [rows, [tot]] = await Promise.all([
    base(db).where(where).orderBy(...orderBy(f.sort)).limit(f.limit).offset(f.offset),
    db
      .select({ n: count() })
      .from(staleItems)
      .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
      .leftJoin(payees, eq(payees.id, staleItems.ownerPayeeId))
      .where(where),
  ]);
  return {
    asOf: todayDate,
    total: Number(tot?.n ?? 0),
    limit: f.limit,
    offset: f.offset,
    items: rows.map((r) => toRow(r, todayDate)),
  };
}

/** All open (or all) rows with no paging; used by deadlines/interest. */
export async function loadOpenRows(db: Db, companyId: string) {
  const rows = await base(db).where(and(eq(staleItems.companyId, companyId), openStatusCondition()));
  return rows;
}

export async function getStaleItemRow(db: Db, id: string, todayDate?: IsoDate): Promise<StaleItemRow | null> {
  const [r] = await base(db).where(eq(staleItems.id, id)).limit(1);
  if (!r) return null;
  const [co] = await db.select({ c: staleItems.companyId }).from(staleItems).where(eq(staleItems.id, id));
  return toRow(r, todayDate ?? (await today(db, co!.c)));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve a stale-item uuid or a check/reference number (e.g. "10482", "#10482") to a stale item id. */
export async function findStaleItemId(db: Db, companyId: string, idOrCheckNumber: string): Promise<string | null> {
  const key = idOrCheckNumber.trim().replace(/^#/, "");
  if (UUID_RE.test(key)) {
    const [r] = await db
      .select({ id: staleItems.id })
      .from(staleItems)
      .where(and(eq(staleItems.companyId, companyId), or(eq(staleItems.id, key), eq(staleItems.ledgerItemId, key))))
      .limit(1);
    if (r) return r.id;
  }
  const rows = await db
    .select({ id: staleItems.id })
    .from(staleItems)
    .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
    .where(and(eq(staleItems.companyId, companyId), eq(ledgerItems.referenceNumber, key)))
    .orderBy(asc(staleItems.createdAt));
  return rows[0]?.id ?? null;
}

export const FEATURED_CHECK_NUMBER = "10482";

export async function getFeaturedItem(db: Db, companyId: string): Promise<StaleItemRow | null> {
  const id = await findStaleItemId(db, companyId, FEATURED_CHECK_NUMBER);
  return id ? getStaleItemRow(db, id) : null;
}

export async function getStatusCounts(db: Db, companyId: string) {
  const rows = await db
    .select({ status: staleItems.status, n: count(), cents: sum(staleItems.amountCents) })
    .from(staleItems)
    .where(eq(staleItems.companyId, companyId))
    .groupBy(staleItems.status);
  return rows
    .map((r) => ({
      status: r.status,
      count: Number(r.n),
      ...money(Number(r.cents ?? 0)),
      open: !(CLOSED_STATUSES as readonly string[]).includes(r.status),
    }))
    .sort((a, b) => a.status.localeCompare(b.status));
}
