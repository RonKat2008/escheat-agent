/**
 * R8 Escheat Ledger: summary journal entries for a period's movements, one per movement kind, state, property type
 * and calendar month (remittances one per filed report too), posted to the example chart in ./accounts.ts:
 *   recognized (void stale check)      Dr Cash                                Cr Unclaimed property payable (state)
 *   recognized (credit / unapplied)    Dr AR credit balances / Unapplied cash Cr Unclaimed property payable (state)
 *   remitted, resolved, cleared late   Dr Unclaimed property payable (state)  Cr Cash
 * An entry never spans months: its date is the latest movement date inside its own month, so a period's entries are
 * exactly the period's roll-forward movements and monthly exports add up to the fiscal-year export.
 * Debits equal credits per entry and per state; both are checked, not assumed. Nothing is posted anywhere: this is
 * what the page shows and the CSV exports. Pure.
 */
import { CASH, recognitionDebit, upPayable, type Account, type PropertyType } from "./accounts";
import type { Movement, MovementKind } from "./movements";
import { monthLabel } from "@/lib/close-pack/period";
import { stateOrder } from "./rollforward";

export interface JournalLine {
  account: Account;
  debitCents: number;
  creditCents: number;
}

export interface JournalEntry {
  /**
   * "JE-<state>-<yyyymm>-<seq>", derived from content: the same entry has the same number in every export (month,
   * quarter, FY), so imports never collide. The sequence is per state and month, in a fixed kind/type/ref order.
   */
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
  /** Prior-period adjustment (R10-01): backdated into this closed month "YYYY-MM", posted in the open month `date` is in. */
  priorPeriodOf?: string;
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
    const month = m.date.slice(0, 7);
    const pp = m.priorPeriodOf ?? "";
    const key = m.kind === "remitted" ? `remitted|${m.state}|${m.reportId ?? "none"}|${m.propertyType}|${month}|${pp}` : `${m.kind}|${m.state}||${m.propertyType}|${month}|${pp}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const drafts = [...groups.values()].map((g) => {
    const first = g[0]!;
    const cents = sum(g.map((m) => m.amountCents));
    const date = g.reduce((d, m) => (m.date > d ? m.date : d), first.date);
    const lines = linesFor(first.kind, first.state, first.propertyType, cents);
    const unverified =
      first.kind === "remitted" && g.some((m) => m.dependsOnUnverified || (m.reportId ? (reports.get(m.reportId)?.unverifiedRuleCount ?? 0) > 0 : false));
    const priorPeriodOf = first.priorPeriodOf;
    const memo = memoFor(first.kind, first.state, first.propertyType, g.length);
    return {
      date,
      kind: first.kind,
      state: first.state,
      propertyType: first.propertyType,
      ...(priorPeriodOf ? { priorPeriodOf } : {}),
      memo: priorPeriodOf ? `Prior-period adjustment (${monthLabel(priorPeriodOf)} is closed): ${memo}` : memo,
      ref: refFor(g, reports),
      lines,
      itemIds: g.map((m) => m.itemId),
      unverified,
      balanced: sum(lines.map((l) => l.debitCents)) === sum(lines.map((l) => l.creditCents)),
    };
  });
  // JE numbers: per state and month, in a content-only order (kind, type, ref), so they do not depend on the period.
  const seqOrder = [...drafts].sort(
    (a, b) =>
      a.date.slice(0, 7).localeCompare(b.date.slice(0, 7)) ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.propertyType.localeCompare(b.propertyType) ||
      a.ref.localeCompare(b.ref),
  );
  const counters = new Map<string, number>();
  const jeOf = new Map<(typeof drafts)[number], string>();
  for (const d of seqOrder) {
    const yyyymm = d.date.slice(0, 7).replace("-", "");
    const k = `${d.state}-${yyyymm}${d.priorPeriodOf ? "-PPA" : ""}`;
    const n = (counters.get(k) ?? 0) + 1;
    counters.set(k, n);
    jeOf.set(d, `JE-${k}-${String(n).padStart(2, "0")}`);
  }
  return finalizeJournal(sortEntries(drafts.map((d) => ({ ...d, je: jeOf.get(d)! }))));
}

/** The journal's display order: date, kind, state, type, ref (copy). */
export function sortEntries(entries: readonly JournalEntry[]): JournalEntry[] {
  return [...entries].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      stateOrder(a.state, b.state) ||
      a.propertyType.localeCompare(b.propertyType) ||
      a.ref.localeCompare(b.ref) ||
      a.je.localeCompare(b.je),
  );
}

/** Per-state and overall debit/credit balance of an ordered list of entries. */
export function finalizeJournal(entries: JournalEntry[]): Journal {
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
