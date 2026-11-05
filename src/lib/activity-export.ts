import type { Db } from "@/db/client";
import { now } from "@/lib/clock";
import { loadClockHistory } from "@/lib/clock-history";
import { csvRow, toCsv } from "@/lib/csv";
import { verifyChain } from "@/lib/audit/chain-db";
import type { ChainVerification } from "@/lib/audit/chain";
import { listActivity, type ActivityEntry, type ActivityFilters } from "@/lib/queries/activity";

const PAGE = 200;
/** Hard ceiling so one request can never stream an unbounded table. */
export const ACTIVITY_MAX_ROWS = 5000;

export const CSV_HEADER = ["timestamp_utc", "demo_day", "kind", "title", "detail", "actor", "state", "payload_sha256_prefix", "needs_attention", "link", "event_id", "chain_head_sha256"] as const;

/** Every row carries the stored audit chain head at export time, so the file can be checked against the chain later. */
export const activityCsvFields = (head: string) => (e: ActivityEntry) => [e.at.toISOString(), e.demoDay, e.kind, e.title, e.detail, e.actor, e.state, e.payloadHash, e.attention ? "yes" : "no", e.href, e.id, head];

export interface ActivityExport {
  rows: ActivityEntry[];
  truncated: boolean;
  csv: string;
  /** Each data row as written in the CSV (no header, no line break); the audit chain hashes exactly these. */
  csvLines: string[];
  /** The stored audit chain, verified at export time. */
  chain: ChainVerification;
}

/** Every activity row matching `filters` (the cursor is ignored), capped at ACTIVITY_MAX_ROWS, as the CSV the Activity export serves. */
export async function exportActivity(db: Db, companyId: string, filters: ActivityFilters): Promise<ActivityExport> {
  const [today, history, chain] = await Promise.all([now(db, companyId), loadClockHistory(db, companyId), verifyChain(db, companyId)]);
  const clock = { history, today };
  const rows: ActivityEntry[] = [];
  let cursor: string | null = null;
  let truncated = false;
  do {
    const page = await listActivity(db, companyId, { ...filters, clock, cursor, limit: PAGE });
    rows.push(...page.entries);
    cursor = page.nextCursor;
    if (rows.length >= ACTIVITY_MAX_ROWS) {
      truncated = Boolean(cursor);
      break;
    }
  } while (cursor);
  const kept = rows.slice(0, ACTIVITY_MAX_ROWS);
  const fields = kept.map(activityCsvFields(chain.headHash));
  return { rows: kept, truncated, csv: toCsv(CSV_HEADER, fields), csvLines: fields.map(csvRow), chain };
}
