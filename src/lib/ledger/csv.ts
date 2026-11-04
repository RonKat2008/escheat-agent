/**
 * R8 Escheat Ledger: the journal as an import file (one row per JE line). A file only: nothing is posted and no
 * accounting system is connected. Amounts are plain decimals ("773.74"), the zero side left blank.
 */
import { toCsv } from "@/lib/csv";
import { accountLabel } from "./accounts";
import type { JournalEntry } from "./journal";

export const JE_CSV_HEADER = ["Date", "JE#", "Account", "Debit", "Credit", "Memo", "Ref"] as const;

/** Integer cents as "1234.56" (no symbol, no thousands separator); blank for zero. */
export function decimal(cents: number): string {
  if (cents === 0) return "";
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function journalRows(entries: readonly JournalEntry[]): string[][] {
  return entries.flatMap((e) => e.lines.map((l) => [e.date, e.je, accountLabel(l.account), decimal(l.debitCents), decimal(l.creditCents), e.memo, e.ref]));
}

export function journalCsv(entries: readonly JournalEntry[]): string {
  return toCsv(JE_CSV_HEADER, journalRows(entries));
}
