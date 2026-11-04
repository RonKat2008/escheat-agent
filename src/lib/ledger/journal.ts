/**
 * R8 Escheat Ledger: summary journal entries for a period's movements, one per state and property type (remittances
 * one per filed report and property type), posted to the example chart in ./accounts.ts:
 *   recognized (void stale check)      Dr Cash                                Cr Unclaimed property payable (state)
 *   recognized (credit / unapplied)    Dr AR credit balances / Unapplied cash Cr Unclaimed property payable (state)
 *   remitted, resolved, cleared late   Dr Unclaimed property payable (state)  Cr Cash
 * Debits equal credits per entry and per state; both are checked, not assumed. Nothing is posted anywhere: this is
 * what the page shows and the CSV exports. Pure.
 */
import { CASH, recognitionDebit, upPayable, type Account, type PropertyType } from "./accounts";
import type { Movement, MovementKind } from "./movements";
import { stateOrder } from "./rollforward";

export interface JournalLine {
  account: Account;
  debitCents: number;
  creditCents: number;
}

export interface JournalEntry {
  /** "JE-001", in date order within the period. */
  je: string;
  date: string;
  kind: MovementKind;
  state: string;
  propertyType: PropertyType;
  memo: string;
  ref: string;
  lines: JournalLine[];
  itemIds: string[];
  /** The figure rests on an UNVERIFIED rule (a remittance whose filing relied on unverified rule values). */
  unverified: boolean;
  balanced: boolean;
}

export interface StateBalance {
  state: string;
  debitCents: number;
  creditCents: number;
  balanced: boolean;
}

export interface Journal {
  entries: JournalEntry[];
  byState: StateBalance[];
  debitCents: number;
  creditCents: number;
  balanced: boolean;
}

/** What a remittance entry cites: the replica confirmation (reports.replica_confirmation) and the filing's unverified count. */
export interface ReportRef {
  confirmation: string | null;
  unverifiedRuleCount: number;
}

const TYPE_LABEL: Record<PropertyType, string> = {
  vendor_check: "vendor checks",
  payroll_check: "payroll checks",
  customer_credit: "customer credits",
  unapplied_cash: "unapplied cash",
};
const KIND_ORDER: MovementKind[] = ["identified", "resolved", "cleared_late", "remitted"];
const plural = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

function memoFor(kind: MovementKind, state: string, type: PropertyType, n: number): string {
  const what = TYPE_LABEL[type];
  switch (kind) {
    case "identified":
      return type === "vendor_check" || type === "payroll_check"
        ? `Void stale ${what} to UP payable (${state}): ${plural(n)}`
        : `Reclass ${what} to UP payable (${state}): ${plural(n)}`;
    case "resolved":
      return `Reissued to owner, ${what} (${state}): ${plural(n)}`;
    case "cleared_late":
      return `Cleared late by bank, ${what} (${state}): ${plural(n)}`;
    case "remitted":
      return `Remitted to ${state}, ${what}: ${plural(n)}`;
  }
}

function linesFor(kind: MovementKind, state: string, type: PropertyType, cents: number): JournalLine[] {
  const payable = upPayable(state);
  if (kind === "identified") {
    return [
      { account: recognitionDebit(type), debitCents: cents, creditCents: 0 },
      { account: payable, debitCents: 0, creditCents: cents },
    ];
  }
  return [
    { account: payable, debitCents: cents, creditCents: 0 },
    { account: CASH, debitCents: 0, creditCents: cents },
  ];
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

function refFor(group: Movement[], reports: ReadonlyMap<string, ReportRef>): string {
  const first = group[0]!;
  if (first.kind !== "remitted") return `${first.kind === "identified" ? "STALE" : first.kind === "resolved" ? "OWNER" : "CLEAR"}-${first.state}-${first.propertyType}`;
  const confirmation = first.reportId ? reports.get(first.reportId)?.confirmation : null;
  const refs = [confirmation, first.reference].filter((x): x is string => Boolean(x));
  return refs.length > 0 ? refs.join(" / ") : first.reportId ? `report ${first.reportId.slice(0, 8)}` : "remittance (no report recorded)";
}

export function buildJournal(movements: readonly Movement[], reports: ReadonlyMap<string, ReportRef> = new Map()): Journal {
  const groups = new Map<string, Movement[]>();
  for (const m of movements) {
    const key = m.kind === "remitted" ? `remitted|${m.state}|${m.reportId ?? "none"}|${m.propertyType}` : `${m.kind}|${m.state}||${m.propertyType}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const drafts = [...groups.values()].map((g) => {
    const first = g[0]!;
    const cents = sum(g.map((m) => m.amountCents));
    const date = g.reduce((d, m) => (m.date > d ? m.date : d), first.date);
    const lines = linesFor(first.kind, first.state, first.propertyType, cents);
    const unverified =
      first.kind === "remitted" && g.some((m) => m.dependsOnUnverified || (m.reportId ? (reports.get(m.reportId)?.unverifiedRuleCount ?? 0) > 0 : false));
    return {
      date,
      kind: first.kind,
      state: first.state,
      propertyType: first.propertyType,
      memo: memoFor(first.kind, first.state, first.propertyType, g.length),
      ref: refFor(g, reports),
      lines,
      itemIds: g.map((m) => m.itemId),
      unverified,
      balanced: sum(lines.map((l) => l.debitCents)) === sum(lines.map((l) => l.creditCents)),
    };
  });
  drafts.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      stateOrder(a.state, b.state) ||
      a.propertyType.localeCompare(b.propertyType) ||
      a.ref.localeCompare(b.ref),
  );
  const entries: JournalEntry[] = drafts.map((d, i) => ({ ...d, je: `JE-${String(i + 1).padStart(3, "0")}` }));

  const states = [...new Set(entries.map((e) => e.state))].sort(stateOrder);
  const byState = states.map((state) => {
    const lines = entries.filter((e) => e.state === state).flatMap((e) => e.lines);
    const debitCents = sum(lines.map((l) => l.debitCents));
    const creditCents = sum(lines.map((l) => l.creditCents));
    return { state, debitCents, creditCents, balanced: debitCents === creditCents };
  });
  const debitCents = sum(byState.map((s) => s.debitCents));
  const creditCents = sum(byState.map((s) => s.creditCents));
  return { entries, byState, debitCents, creditCents, balanced: debitCents === creditCents && entries.every((e) => e.balanced) && byState.every((s) => s.balanced) };
}
