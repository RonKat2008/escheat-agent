import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { ledgerItems } from "@/db/schema";
import { insertLedgerRows, resolvePayees } from "@/lib/ingest/persist";
import { LedgerRowSchema, type LedgerRow } from "@/lib/ingest/schemas";
import { requireQbo, requireTokenSecret, type QboConfig } from "../config";
import { createConnectionStore, drizzleRawStore, type ConnectionStore } from "../store";
import { createQboApi, type FetchLike, type QboApi } from "./client";

export const QBO_PAGE_SIZE = 1000;
const VENDOR_CHUNK = 100;

const RefSchema = z.object({ value: z.string(), name: z.string().optional(), type: z.string().optional() });

export const PurchaseSchema = z.object({
  Id: z.string(),
  DocNumber: z.string().optional(),
  TxnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  TotalAmt: z.number(),
  EntityRef: RefSchema.optional(),
  PrivateNote: z.string().optional(),
  Credit: z.boolean().optional(),
});
export type Purchase = z.infer<typeof PurchaseSchema>;

const PurchaseQuerySchema = z.object({
  QueryResponse: z.object({ Purchase: z.array(PurchaseSchema).optional() }),
});

const AddrSchema = z.object({
  Line1: z.string().optional(),
  Line2: z.string().optional(),
  Line3: z.string().optional(),
  Line4: z.string().optional(),
  Line5: z.string().optional(),
  City: z.string().optional(),
  CountrySubDivisionCode: z.string().optional(),
  PostalCode: z.string().optional(),
});
export const VendorSchema = z.object({
  Id: z.string(),
  DisplayName: z.string().optional(),
  PrintOnCheckName: z.string().optional(),
  BillAddr: AddrSchema.optional(),
});
export type Vendor = z.infer<typeof VendorSchema>;

const VendorQuerySchema = z.object({
  QueryResponse: z.object({ Vendor: z.array(VendorSchema).optional() }),
});

/** Join BillAddr Line1..Line5 into one street line. */
export function joinAddress(addr: z.infer<typeof AddrSchema> | undefined): string | undefined {
  if (!addr) return undefined;
  const lines = [addr.Line1, addr.Line2, addr.Line3, addr.Line4, addr.Line5]
    .map((l) => l?.trim())
    .filter((l): l is string => Boolean(l));
  return lines.length > 0 ? lines.join(", ") : undefined;
}

/**
 * QBO has no voided flag on Purchase. UNVERIFIED convention (API-NOTES section 8): a void zeroes
 * TotalAmt and sets PrivateNote to "Voided". We only mark voided when BOTH hold; anything
 * uncertain is treated as not voided (a zero-amount check with no void note still imports).
 */
export function isVoided(p: Purchase): boolean {
  return p.TotalAmt === 0 && /\bvoid/i.test(p.PrivateNote ?? "");
}

export interface MapResult {
  row?: LedgerRow;
  raw?: Record<string, string>;
  skipped?: string;
}

const clean = (s: string | undefined) => (s && s.trim() !== "" ? s.trim() : undefined);

export function mapPurchase(p: Purchase, vendor: Vendor | undefined): MapResult {
  if (p.Credit) return { skipped: `Purchase ${p.Id}: check credit/refund, not an outstanding check` };
  const payeeName = clean(p.EntityRef?.name) ?? clean(vendor?.PrintOnCheckName) ?? clean(vendor?.DisplayName);
  if (!payeeName) return { skipped: `Purchase ${p.Id}: no payee name` };
  const candidate = {
    kind: p.EntityRef?.type === "Employee" ? "payroll_check" : "check",
    number: clean(p.DocNumber),
    payeeName,
    payeeAddress: joinAddress(vendor?.BillAddr),
    payeeCity: clean(vendor?.BillAddr?.City),
    payeeState: clean(vendor?.BillAddr?.CountrySubDivisionCode),
    payeeZip: clean(vendor?.BillAddr?.PostalCode),
    amount: Math.round(p.TotalAmt * 100),
    issueDate: p.TxnDate,
    voided: isVoided(p),
    memo: clean(p.PrivateNote),
  };
  const parsed = LedgerRowSchema.safeParse(candidate);
  if (!parsed.success) return { skipped: `Purchase ${p.Id}: ${parsed.error.issues[0]?.message ?? "invalid"}` };
  return { row: parsed.data, raw: { _qboId: p.Id } };
}

export async function fetchAllChecks(api: QboApi, pageSize: number = QBO_PAGE_SIZE): Promise<Purchase[]> {
  const all: Purchase[] = [];
  for (let start = 1; ; start += pageSize) {
    const res = await api.query(
      `select * from Purchase where PaymentType = 'Check' orderby Id startposition ${start} maxresults ${pageSize}`,
      PurchaseQuerySchema,
    );
    const page = res.QueryResponse.Purchase ?? [];
    all.push(...page);
    if (page.length < pageSize) return all;
  }
}

export async function fetchVendors(api: QboApi, ids: readonly string[]): Promise<Map<string, Vendor>> {
  const out = new Map<string, Vendor>();
  for (let i = 0; i < ids.length; i += VENDOR_CHUNK) {
    const list = ids
      .slice(i, i + VENDOR_CHUNK)
      .map((id) => `'${id.replace(/[^A-Za-z0-9_-]/g, "")}'`)
      .join(",");
    const res = await api.query(`select * from Vendor where Id in (${list})`, VendorQuerySchema);
    for (const v of res.QueryResponse.Vendor ?? []) out.set(v.Id, v);
  }
  return out;
}

export interface PullSummary {
  fetched: number;
  inserted: number;
  skipped: number;
  voided: number;
  payeesLinked: number;
  notes: string[];
}

export interface PullDeps {
  cfg?: QboConfig;
  store?: ConnectionStore;
  fetch?: FetchLike;
  pageSize?: number;
}

/** Pull Check purchases from the QBO sandbox into ledger_items (source 'qbo'). */
export async function pullQboChecks(db: Db, companyId: string, deps: PullDeps = {}): Promise<PullSummary> {
  const cfg = deps.cfg ?? requireQbo();
  const store = deps.store ?? createConnectionStore(drizzleRawStore(db), requireTokenSecret("qbo"));
  const api = createQboApi({ cfg, store, companyId, fetch: deps.fetch });

  const purchases = await fetchAllChecks(api, deps.pageSize);
  const vendorIds = [
    ...new Set(purchases.filter((p) => p.EntityRef?.type === "Vendor").map((p) => p.EntityRef!.value)),
  ];
  const vendors = await fetchVendors(api, vendorIds);

  const rows: LedgerRow[] = [];
  const raws: Record<string, string>[] = [];
  const notes: string[] = [];
  for (const p of purchases) {
    const vendor = p.EntityRef?.type === "Vendor" ? vendors.get(p.EntityRef.value) : undefined;
    const m = mapPurchase(p, vendor);
    if (m.row && m.raw) {
      rows.push(m.row);
      raws.push(m.raw);
    } else if (m.skipped) notes.push(m.skipped);
  }
  if (rows.some((r) => r.voided)) {
    notes.push("Voided checks were detected by TotalAmt 0 + 'Void' in PrivateNote (unverified QBO convention).");
  }

  const summary = await insertLedgerRows(db, companyId, rows, raws);
  // insertLedgerRows stamps source 'csv'; re-tag rows that carry a QBO id.
  await db
    .update(ledgerItems)
    .set({ source: "qbo" })
    .where(
      and(
        eq(ledgerItems.companyId, companyId),
        eq(ledgerItems.source, "csv"),
        sql`jsonb_exists(${ledgerItems.rawRow}, '_qboId')`,
      ),
    );
  const linked = await resolvePayees(db, companyId);
  return {
    fetched: purchases.length,
    inserted: summary.inserted,
    skipped: summary.skipped + (purchases.length - rows.length),
    voided: rows.filter((r) => r.voided).length,
    payeesLinked: linked.itemsLinked,
    notes,
  };
}
