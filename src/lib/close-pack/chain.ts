/**
 * The pack's audit chain. The prototype stores no tamper-evident log, so the chain is DERIVED at export time from the
 * Activity rows in the pack: link[i] = sha256(link[i-1] + "\n" + sha256(row[i])), starting from 64 zeros. The head is
 * the last link. Anyone can recompute it from activity-<period>.csv (one hash per data row, as written), so the
 * "verified" flag means "the CSV in this pack reproduces the head", not "the database is tamper-proof". Pure.
 */
import { sha256Hex } from "@/lib/crypto";

export const CHAIN_GENESIS = "0".repeat(64);

export interface AuditChain {
  length: number;
  head: string;
}

export function buildChain(rows: readonly string[]): AuditChain {
  let link = CHAIN_GENESIS;
  for (const row of rows) link = sha256Hex(`${link}\n${sha256Hex(row)}`);
  return { length: rows.length, head: link };
}

/** The data rows of a CSV exactly as written (header dropped, CRLF separated, trailing break dropped). */
export function csvDataLines(csv: string): string[] {
  const lines = csv.split("\r\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(1);
}

/** Recomputes the chain from a CSV's own bytes and compares it with the claimed head and length. */
export function verifyChain(csv: string, claimed: AuditChain): boolean {
  const again = buildChain(csvDataLines(csv));
  return again.head === claimed.head && again.length === claimed.length;
}
