import { z } from "zod";
import type { Db } from "@/db/client";
import { insertClearRows } from "@/lib/ingest/persist";
import { ClearRowSchema, type ClearRow } from "@/lib/ingest/schemas";
import { IntegrationError } from "../errors";
import type { PlaidConfig } from "../config";
import type { FetchLike } from "../qbo/client";
import type { ConnectionStore } from "../store";
import { defaultPlaidDeps, plaidPost } from "./client";

export const PlaidTxnSchema = z.object({
  transaction_id: z.string(),
  amount: z.number(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().nullish(),
  original_description: z.string().nullish(),
  check_number: z.string().nullish(),
  pending: z.boolean().optional(),
});
export type PlaidTxn = z.infer<typeof PlaidTxnSchema>;

const SyncSchema = z.object({
  added: z.array(PlaidTxnSchema),
  modified: z.array(PlaidTxnSchema),
  removed: z.array(z.object({ transaction_id: z.string() })),
  next_cursor: z.string(),
  has_more: z.boolean(),
});

const CHECK_WORD = /\b(?:check|cheque|chk)\b/i;
const CHECK_NUMBER = /\b(?:check|cheque|chk)\s*(?:no\.?|number|#)?\s*#?\s*(\d{3,})\b/i;

/** Extract a check number from Plaid's check_number or a "CHECK 10482"-style description. */
export function extractCheckNumber(t: Pick<PlaidTxn, "check_number" | "name" | "original_description">): string | undefined {
  const direct = t.check_number?.trim();
  if (direct) return direct.replace(/^0+(?=\d)/, "");
  for (const text of [t.name, t.original_description]) {
    const m = text ? CHECK_NUMBER.exec(text) : null;
    if (m) return m[1]!.replace(/^0+(?=\d)/, "");
  }
  return undefined;
}

/** Plaid debits (money out) that are checks, as canonical clear rows. Others return undefined. */
export function mapPlaidTxn(t: PlaidTxn): ClearRow | undefined {
  if (t.pending || t.amount <= 0) return undefined;
  const description = t.original_description?.trim() || t.name?.trim() || undefined;
  const checkNumber = extractCheckNumber(t);
  if (!checkNumber && !CHECK_WORD.test(`${t.name ?? ""} ${t.original_description ?? ""}`)) return undefined;
  const parsed = ClearRowSchema.safeParse({
    checkNumber,
    amount: Math.round(t.amount * 100),
    clearedDate: t.date,
    description,
  });
  return parsed.success ? parsed.data : undefined;
}

export interface PlaidSyncSummary {
  pages: number;
  transactions: number;
  inserted: number;
  skipped: number;
  ignored: number;
  cursor: string;
}

export interface PlaidSyncDeps {
  cfg?: PlaidConfig;
  store?: ConnectionStore;
  fetch?: FetchLike;
  pageSize?: number;
}

/**
 * Page /transactions/sync from the stored cursor, store check debits in bank_clears with
 * source 'plaid', then persist the new cursor (only after the insert succeeded).
 */
export async function syncPlaidClears(db: Db, companyId: string, deps: PlaidSyncDeps = {}): Promise<PlaidSyncSummary> {
  const d = deps.cfg && deps.store ? { cfg: deps.cfg, store: deps.store } : defaultPlaidDeps(db);
  const cfg = deps.cfg ?? d.cfg;
  const store = deps.store ?? d.store;
  const conn = await store.get(companyId, "plaid");
  if (!conn?.accessToken) throw new IntegrationError("Plaid is not connected for this company", 409);

  let cursor = conn.cursor ?? "";
  let pages = 0;
  const txns: PlaidTxn[] = [];
  for (;;) {
    const page = await plaidPost(
      cfg,
      "/transactions/sync",
      { access_token: conn.accessToken, cursor: cursor || undefined, count: deps.pageSize ?? 500 },
      SyncSchema,
      deps.fetch,
    );
    pages++;
    txns.push(...page.added, ...page.modified);
    cursor = page.next_cursor;
    if (!page.has_more) break;
  }

  const rows = txns.map(mapPlaidTxn);
  const clears = rows.filter((r): r is ClearRow => r !== undefined);
  const { inserted, skipped } = await insertClearRows(db, companyId, clears, { source: "plaid" });
  await store.save({ ...conn, cursor });

  return {
    pages,
    transactions: txns.length,
    inserted,
    skipped,
    ignored: txns.length - clears.length,
    cursor,
  };
}
