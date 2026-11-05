/**
 * Tamper-evident audit chain: the pure half (hashing, canonical form, verification). No database, no LLM.
 *
 * Every recorded event is one row. Row n's hash is sha256 over the canonical JSON (keys sorted, see canonicalJson) of
 *   { seq, prevHash, occurredAt (ISO 8601, ms), kind, subject: { type, id }, payload }
 * and row n+1 stores that hash as its prevHash. Row 1's prevHash is GENESIS_HASH. Editing any field of any row, deleting
 * a row, or swapping two rows changes a recomputed hash or breaks the seq/prevHash link, so verifyRows finds it.
 *
 * What it proves: the stored rows are the ones that were appended, in that order, unedited. What it does not prove:
 * that an event which never reached appendAuditEvent happened, or that someone with database access did not rebuild
 * the whole chain from scratch (anchoring the head hash elsewhere, e.g. in a binder PDF, covers that).
 */
import { canonicalJson, sha256Hex } from "@/lib/crypto";

export const GENESIS_HASH = "0".repeat(64);

export interface ChainEventInput {
  kind: string;
  subjectType: string;
  subjectId: string;
  /** JSON-safe facts. Stored as canonical JSON text. */
  payload: unknown;
  occurredAt: Date;
}

export interface ChainRow {
  seq: number;
  occurredAt: Date;
  kind: string;
  subjectType: string;
  subjectId: string;
  /** Canonical JSON text. */
  payload: string;
  prevHash: string;
  hash: string;
}

export interface ChainVerification {
  ok: boolean;
  length: number;
  /** Hash of the last row as stored (GENESIS_HASH for an empty chain). */
  headHash: string;
  /** The first seq position where the chain stops checking out (1-based position in the ordered rows). */
  firstBrokenSeq?: number;
  reason?: string;
}

/** The exact string that is hashed for a row. */
export function chainHashInput(row: Omit<ChainRow, "hash">): string {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    // An unparseable payload still hashes deterministically (as the raw string), so it is reported as a hash mismatch.
    payload = { unparseable: row.payload };
  }
  return canonicalJson({
    seq: row.seq,
    prevHash: row.prevHash,
    occurredAt: row.occurredAt.toISOString(),
    kind: row.kind,
    subject: { type: row.subjectType, id: row.subjectId },
    payload,
  });
}

export function chainHash(row: Omit<ChainRow, "hash">): string {
  return sha256Hex(chainHashInput(row));
}

/** Build the next row after `head` (null = empty chain). Pure. */
export function nextChainRow(head: { seq: number; hash: string } | null, ev: ChainEventInput): ChainRow {
  const base = {
    seq: (head?.seq ?? 0) + 1,
    occurredAt: new Date(ev.occurredAt.getTime()),
    kind: ev.kind,
    subjectType: ev.subjectType,
    subjectId: ev.subjectId,
    payload: canonicalJson(ev.payload ?? null),
    prevHash: head?.hash ?? GENESIS_HASH,
  };
  return { ...base, hash: chainHash(base) };
}

/**
 * Recompute every hash in order. `rows` must be the stored rows ordered by seq ascending (as read). Checks, per row:
 * seq is exactly previous + 1 (a gap means a deleted row, a step back means reordering), prevHash equals the previous
 * row's stored hash, and the stored hash equals the recomputed one.
 */
export function verifyRows(rows: readonly ChainRow[]): ChainVerification {
  let prevHash = GENESIS_HASH;
  let prevSeq = 0;
  for (const row of rows) {
    const broken = (reason: string, at = row.seq): ChainVerification => ({ ok: false, length: rows.length, headHash: rows.at(-1)!.hash, firstBrokenSeq: at, reason });
    if (row.seq > prevSeq + 1) return broken(`Row #${prevSeq + 1} is missing (the next stored row is #${row.seq}).`, prevSeq + 1);
    if (row.seq !== prevSeq + 1) return broken(`Row #${row.seq} is out of order (it comes after #${prevSeq}).`);
    if (row.prevHash !== prevHash) return broken(`Row #${row.seq} does not point at the hash of row #${prevSeq || "genesis"}.`);
    if (chainHash(row) !== row.hash) return broken(`Row #${row.seq}'s contents do not match its hash.`);
    prevHash = row.hash;
    prevSeq = row.seq;
  }
  return { ok: true, length: rows.length, headHash: rows.at(-1)?.hash ?? GENESIS_HASH };
}

/** "3f9a…c21e" */
export const shortHash = (h: string): string => (h.length > 10 ? `${h.slice(0, 4)}…${h.slice(-4)}` : h);
