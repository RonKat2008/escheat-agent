import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  bankClears,
  ledgerItems,
  payees,
  type LedgerItem,
  type NewBankClear,
  type NewLedgerItem,
  type PropertyType,
} from "@/db/schema";
import { clusterPayees, type ClusterOptions, type PayeeInput } from "@/lib/payees/cluster";
import { reconcile, type ReconcileOptions, type ReconcileResult } from "@/lib/recon/reconcile";
import { propertyTypeFromIngestKind, reconKindOfPropertyType } from "@/lib/property-kinds";
import type { ClearRow, LedgerKind, LedgerRow } from "./schemas";

const CHUNK = 500;
type LedgerSource = NonNullable<NewLedgerItem["source"]>;
type ClearSource = NonNullable<NewBankClear["source"]>;

const PROPERTY_TYPE = (k: LedgerKind): PropertyType => propertyTypeFromIngestKind(k);

function chunks<T>(xs: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export interface InsertSummary {
  inserted: number;
  /** rows identical to ones already stored for the company (re-ingest is idempotent) */
  skipped: number;
}

const ledgerKey = (r: {
  propertyType: string;
  referenceNumber?: string | null;
  amountCents: number;
  issueDate: string;
  payeeNameRaw: string;
}) => [r.propertyType, r.referenceNumber ?? "", r.amountCents, r.issueDate, r.payeeNameRaw.trim().toLowerCase()].join("|");

/** Persist parsed ledger rows. `source` defaults to 'csv' and is stored in the column and raw_row._source. */
export async function insertLedgerRows(
  db: Db,
  companyId: string,
  rows: readonly LedgerRow[],
  raws: readonly Record<string, string>[] = [],
  opts: { source?: LedgerSource } = {},
): Promise<InsertSummary> {
  const source = opts.source ?? "csv";
  const existing = await db.select().from(ledgerItems).where(eq(ledgerItems.companyId, companyId));
  const seen = new Set(existing.map(ledgerKey));
  const toInsert: NewLedgerItem[] = [];
  let skipped = 0;
  rows.forEach((r, i) => {
    const row: NewLedgerItem = {
      companyId,
      payeeNameRaw: r.payeeName,
      propertyType: PROPERTY_TYPE(r.kind),
      referenceNumber: r.number ?? null,
      amountCents: r.amount,
      issueDate: r.issueDate,
      status: r.voided ? "voided" : "outstanding",
      addressLine: r.payeeAddress ?? null,
      city: r.payeeCity ?? null,
      state: r.payeeState ?? null,
      zip: r.payeeZip ?? null,
      memo: r.memo ?? null,
      rawRow: { ...(raws[i] ?? {}), _source: source },
      source,
    };
    const key = ledgerKey(row as Parameters<typeof ledgerKey>[0]);
    if (seen.has(key)) {
      skipped++;
      return;
    }
    seen.add(key);
    toInsert.push(row);
  });
  for (const batch of chunks(toInsert)) await db.insert(ledgerItems).values(batch);
  return { inserted: toInsert.length, skipped };
}

const clearKey = (r: { referenceNumber?: string | null; amountCents: number; clearedDate: string; description?: string | null }) =>
  [r.referenceNumber ?? "", r.amountCents, r.clearedDate, r.description ?? ""].join("|");

/** Persist parsed bank-clear rows. */
export async function insertClearRows(
  db: Db,
  companyId: string,
  rows: readonly ClearRow[],
  opts: { source?: ClearSource } = {},
): Promise<InsertSummary> {
  const existing = await db.select().from(bankClears).where(eq(bankClears.companyId, companyId));
  const seen = new Set(existing.map(clearKey));
  const toInsert: NewBankClear[] = [];
  let skipped = 0;
  for (const r of rows) {
    const row: NewBankClear = {
      companyId,
      referenceNumber: r.checkNumber ?? null,
      amountCents: r.amount,
      clearedDate: r.clearedDate,
      description: r.description ?? null,
      source: opts.source ?? "csv",
    };
    const key = clearKey(row as Parameters<typeof clearKey>[0]);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    toInsert.push(row);
  }
  for (const batch of chunks(toInsert)) await db.insert(bankClears).values(batch);
  return { inserted: toInsert.length, skipped };
}

export interface PayeeResolution {
  payeesCreated: number;
  payeesUpdated: number;
  itemsLinked: number;
  ambiguousPairs: number;
}

const nonEmpty = (s?: string | null) => (s && s.trim() !== "" ? s.trim() : undefined);

/**
 * Cluster the company's payee names (unlinked ledger items plus existing payees), upsert
 * payees (aliases, merge_basis, merge_confidence) and link ledger items to them.
 */
export async function resolvePayees(db: Db, companyId: string, opts: ClusterOptions = {}): Promise<PayeeResolution> {
  const [items, existing] = await Promise.all([
    db.select().from(ledgerItems).where(and(eq(ledgerItems.companyId, companyId), isNull(ledgerItems.payeeId))),
    db.select().from(payees).where(eq(payees.companyId, companyId)),
  ]);

  // one input per distinct (name, address) group of unlinked items; existing payees join as anchors
  const groups = new Map<string, { input: PayeeInput; itemIds: string[] }>();
  for (const it of items) {
    const key = [it.payeeNameRaw, it.addressLine ?? "", it.zip ?? "", it.state ?? ""].join("|");
    const g = groups.get(key);
    if (g) g.itemIds.push(it.id);
    else
      groups.set(key, {
        itemIds: [it.id],
        input: {
          id: `g:${groups.size}`,
          name: it.payeeNameRaw,
          addressLine: it.addressLine,
          city: it.city,
          state: it.state,
          zip: it.zip,
        },
      });
  }
  const existingById = new Map(existing.map((p) => [`p:${p.id}`, p]));
  const inputs: PayeeInput[] = [
    ...existing.map((p) => ({
      id: `p:${p.id}`,
      name: p.canonicalName,
      addressLine: p.addressLine,
      city: p.city,
      state: p.state,
      zip: p.zip,
    })),
    ...[...groups.values()].map((g) => g.input),
  ];
  if (items.length === 0) return { payeesCreated: 0, payeesUpdated: 0, itemsLinked: 0, ambiguousPairs: 0 };

  const result = await clusterPayees(inputs, opts);
  const groupById = new Map([...groups.values()].map((g) => [g.input.id, g]));
  let created = 0;
  let updated = 0;
  let linked = 0;

  for (const cluster of result.clusters) {
    const newMembers = cluster.members.filter((m) => groupById.has(m.id));
    if (newMembers.length === 0) continue;
    const anchor = cluster.members.find((m) => existingById.has(m.id));
    const aliasSet = new Set(cluster.aliases);
    const first = newMembers[0]!;
    let payeeId: string;
    if (anchor) {
      const row = existingById.get(anchor.id)!;
      const aliases = [...new Set([...row.aliases, ...cluster.members.map((m) => m.name.trim())])].filter(
        (n) => n !== row.canonicalName,
      );
      await db
        .update(payees)
        .set({
          aliases,
          ...(cluster.members.length > 1 && cluster.basis !== "exact" ? { mergeBasis: cluster.basis, mergeConfidence: cluster.confidence } : {}),
        })
        .where(eq(payees.id, row.id));
      payeeId = row.id;
      updated++;
    } else {
      const [row] = await db
        .insert(payees)
        .values({
          companyId,
          canonicalName: cluster.canonicalName,
          aliases: [...aliasSet],
          addressLine: nonEmpty(first.addressLine) ?? null,
          city: nonEmpty(first.city) ?? null,
          state: nonEmpty(first.state) ?? null,
          zip: nonEmpty(first.zip) ?? null,
          mergeBasis: cluster.basis,
          mergeConfidence: cluster.confidence,
        })
        .returning({ id: payees.id });
      payeeId = row!.id;
      created++;
    }
    const itemIds = newMembers.flatMap((m) => groupById.get(m.id)!.itemIds);
    for (const batch of chunks(itemIds)) {
      await db.update(ledgerItems).set({ payeeId }).where(inArray(ledgerItems.id, batch));
    }
    linked += itemIds.length;
  }
  return { payeesCreated: created, payeesUpdated: updated, itemsLinked: linked, ambiguousPairs: result.ambiguous.length };
}

/* ------------------------------------------------------------ reconciliation */

export type OutstandingItem = LedgerItem & { ageDays: number };

type ReconRow = LedgerItem & {
  kind: "check" | "credit" | "unapplied_cash";
  number: string | null;
  voided: boolean;
};
type ReconClearRow = typeof bankClears.$inferSelect & { checkNumber: string | null };

export interface ReconciliationOutput {
  asOf: string;
  result: ReconcileResult<ReconRow, ReconClearRow>;
  /** Outstanding ledger rows (with payeeId and ageDays) for the stale-detection lane. */
  outstanding: OutstandingItem[];
}

const kindOf = (t: PropertyType): ReconRow["kind"] => reconKindOfPropertyType(t);

/**
 * Load a company's ledger + clears, reconcile as of `asOf`, and (unless persist:false) record
 * the outcome: matched items -> status 'cleared' with bank_clears.ledger_item_id set;
 * outstanding items -> 'outstanding'. Does not create stale_items.
 */
export async function runReconciliation(
  db: Db,
  companyId: string,
  asOf: string,
  opts: ReconcileOptions & { persist?: boolean } = {},
): Promise<ReconciliationOutput> {
  const [items, clearRows] = await Promise.all([
    db.select().from(ledgerItems).where(eq(ledgerItems.companyId, companyId)),
    db.select().from(bankClears).where(eq(bankClears.companyId, companyId)),
  ]);
  const ledger: ReconRow[] = items
    .filter((i) => i.status !== "reissued")
    .map((i) => ({ ...i, kind: kindOf(i.propertyType), number: i.referenceNumber, voided: i.status === "voided" }));
  const clears: ReconClearRow[] = clearRows.map((c) => ({ ...c, checkNumber: c.referenceNumber }));

  const result = reconcile(ledger, clears, asOf, opts);

  if (opts.persist !== false) {
    await db.transaction(async (tx) => {
      const matchedIds = result.matched.map((m) => m.ledgerId);
      for (const batch of chunks(matchedIds)) {
        await tx.update(ledgerItems).set({ status: "cleared" }).where(inArray(ledgerItems.id, batch));
      }
      for (const m of result.matched) {
        await tx.update(bankClears).set({ ledgerItemId: m.ledgerId }).where(eq(bankClears.id, m.clearId));
      }
      const reopen = [...result.outstanding, ...result.ambiguous.map((a) => ({ id: a.ledgerId }))]
        .map((o) => o.id)
        .filter((id) => items.find((i) => i.id === id)?.status === "cleared");
      for (const batch of chunks(reopen)) {
        await tx.update(ledgerItems).set({ status: "outstanding" }).where(inArray(ledgerItems.id, batch));
      }
    });
  }

  const outstanding: OutstandingItem[] = result.outstanding.map((o) => {
    const item: Record<string, unknown> = { ...o, status: "outstanding" };
    delete item.kind;
    delete item.number;
    delete item.voided;
    return item as OutstandingItem;
  });
  return { asOf, result, outstanding };
}
