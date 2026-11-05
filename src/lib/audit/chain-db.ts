/**
 * Tamper-evident audit chain: the database half. appendAuditEvent writes one row inside the caller's transaction (the
 * one that made the change), so an event is recorded exactly when its change commits. verifyChain re-reads and
 * recomputes. Pure hashing lives in ./chain.ts.
 */
import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { auditChain } from "@/db/schema";
import { nextChainRow, verifyRows, type ChainEventInput, type ChainRow, type ChainVerification } from "./chain";

export interface AuditEvent extends Omit<ChainEventInput, "occurredAt"> {
  companyId: string;
  occurredAt?: Date;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATE_RE = /^[A-Z]{2}$/;

/**
 * Append one event to the company's chain. `tx` MUST be the transaction that wrote the change being recorded: the row
 * commits or rolls back with it. Appends for one company are serialized by a lock on the company row (FOR NO KEY
 * UPDATE does not block child-table inserts), and (company_id, seq) is unique, so two writers can never fork the chain.
 */
export async function appendAuditEvent(tx: Db, ev: AuditEvent): Promise<ChainRow> {
  await tx.execute(sql`SELECT id FROM companies WHERE id = ${ev.companyId}::uuid FOR NO KEY UPDATE`);
  const [head] = await tx
    .select({ seq: auditChain.seq, hash: auditChain.hash })
    .from(auditChain)
    .where(eq(auditChain.companyId, ev.companyId))
    .orderBy(sql`${auditChain.seq} DESC`)
    .limit(1);
  const row = nextChainRow(head ?? null, { ...ev, occurredAt: ev.occurredAt ?? new Date() });
  await tx.insert(auditChain).values({ companyId: ev.companyId, ...row });
  return row;
}

/**
 * The companies a subject id belongs to (approvals carry no company column; Activity scopes them the same way): a
 * stale item, letter, report, recovery or the company itself by uuid; `remit:<reportId>` for a remittance approval; a
 * two-letter state for rule approvals = every company holding items or reports in that state.
 */
export async function companiesForSubject(tx: Db, subjectId: string): Promise<string[]> {
  const id = subjectId.startsWith("remit:") ? subjectId.slice("remit:".length) : subjectId;
  let rows: { company_id: string }[] = [];
  if (UUID_RE.test(id)) {
    const u = sql`${id}::uuid`;
    rows = await execRows(
      tx,
      sql`SELECT company_id FROM stale_items WHERE id = ${u}
          UNION SELECT company_id FROM outreach WHERE id = ${u}
          UNION SELECT company_id FROM reports WHERE id = ${u}
          UNION SELECT company_id FROM recoveries WHERE id = ${u}
          UNION SELECT id FROM companies WHERE id = ${u}`,
    );
  } else if (STATE_RE.test(id)) {
    rows = await execRows(
      tx,
      sql`SELECT company_id FROM stale_items WHERE owner_state = ${id} UNION SELECT company_id FROM reports WHERE state = ${id}`,
    );
  }
  return [...new Set(rows.map((r) => r.company_id))].sort();
}

/** Append the same event to every company the subject belongs to (usually exactly one). */
export async function appendAuditEventForSubject(tx: Db, subjectId: string, ev: Omit<AuditEvent, "companyId">): Promise<number> {
  const companies = await companiesForSubject(tx, subjectId);
  for (const companyId of companies) await appendAuditEvent(tx, { ...ev, companyId });
  return companies.length;
}

async function execRows<T>(db: Db, q: ReturnType<typeof sql>): Promise<T[]> {
  const res = (await db.execute(q)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(res) ? res : (res.rows ?? []);
}

/** The company's chain, oldest first, as stored. */
export async function loadChain(db: Db, companyId: string): Promise<ChainRow[]> {
  const rows = await db.select().from(auditChain).where(eq(auditChain.companyId, companyId)).orderBy(asc(auditChain.seq));
  return rows.map(({ companyId: _c, ...r }) => {
    void _c;
    return r;
  });
}

/** Recompute every hash of the company's chain in order. */
export async function verifyChain(db: Db, companyId: string): Promise<ChainVerification> {
  return verifyRows(await loadChain(db, companyId));
}

/** Run `fn` in a transaction (a savepoint when `db` already is one), typed as Db for the existing helpers. */
export function inTx<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction((tx) => fn(tx as unknown as Db));
}
