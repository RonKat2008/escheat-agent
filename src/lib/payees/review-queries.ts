/** Read side of /payees: payee rows with item roll-ups plus deterministic merge suggestions. Company-scoped. */
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { ledgerItems, payees, staleItems, type Payee } from "@/db/schema";
import { CLOSED_STATUSES } from "@/lib/queries/common";
import { clusterPayeesSync, pairScore, type PayeeInput } from "./cluster";

/** Merge confidence below this (0..100) is surfaced for review. */
export const LOW_CONFIDENCE = 90;

export interface MergeSuggestion {
  otherId: string;
  otherName: string;
  /** 0..1, from the deterministic pair score. */
  score: number;
  /** likely = at/above the auto-merge threshold but still separate payees; ambiguous = 0.80-0.95 band. */
  kind: "likely" | "ambiguous";
}

export interface PayeeRow {
  id: string;
  canonicalName: string;
  aliases: string[];
  itemCount: number;
  openItemCount: number;
  outstandingCents: number;
  ownerStates: string[];
  mergeBasis: Payee["mergeBasis"];
  mergeConfidence: number | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewAction: string | null;
  needsReview: boolean;
  reasons: string[];
  suggestions: MergeSuggestion[];
}

const toInput = (p: Payee): PayeeInput => ({
  id: p.id,
  name: p.canonicalName,
  addressLine: p.addressLine,
  city: p.city,
  state: p.state,
  zip: p.zip,
});

/** Deterministic suggestions between separate payees: same-cluster pairs (rule) and the ambiguous band. */
export function suggestMerges(rows: readonly Payee[]): Map<string, MergeSuggestion[]> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const inputs = rows.map(toInput);
  const res = clusterPayeesSync(inputs);
  const out = new Map<string, MergeSuggestion[]>();
  const add = (a: string, b: string, score: number, kind: MergeSuggestion["kind"]) => {
    const other = byId.get(b);
    if (!other) return;
    out.set(a, [...(out.get(a) ?? []), { otherId: b, otherName: other.canonicalName, score: Math.round(score * 1000) / 1000, kind }]);
  };
  for (const c of res.clusters) {
    for (const m of c.members) {
      for (const o of c.members) {
        if (m.id !== o.id) add(m.id, o.id, pairScore(m, o), "likely");
      }
    }
  }
  for (const a of res.ambiguous) {
    add(a.a.id, a.b.id, a.score, "ambiguous");
    add(a.b.id, a.a.id, a.score, "ambiguous");
  }
  for (const [k, v] of out) out.set(k, v.sort((x, y) => y.score - x.score));
  return out;
}

export function reviewReasons(p: Payee, suggestions: readonly MergeSuggestion[]): string[] {
  const reasons: string[] = [];
  if (p.mergeBasis === "model") reasons.push("Merged by a model; confirm it");
  if (p.mergeBasis !== "human" && p.mergeConfidence != null && p.mergeConfidence < LOW_CONFIDENCE) {
    reasons.push(`Low merge confidence (${p.mergeConfidence}%)`);
  }
  if (suggestions.some((s) => s.kind === "likely")) reasons.push("Likely duplicate of another payee");
  if (suggestions.some((s) => s.kind === "ambiguous")) reasons.push("Ambiguous pair needs a decision");
  return reasons;
}

export async function listPayees(db: Db, companyId: string): Promise<PayeeRow[]> {
  const [rows, stale] = await Promise.all([
    db.select().from(payees).where(eq(payees.companyId, companyId)).orderBy(asc(payees.canonicalName)),
    db
      .select({ owner: staleItems.ownerPayeeId, cents: staleItems.amountCents, status: staleItems.status, state: staleItems.ownerState })
      .from(staleItems)
      .where(eq(staleItems.companyId, companyId)),
  ]);
  const suggestions = suggestMerges(rows);
  const closed = new Set<string>(CLOSED_STATUSES);
  const roll = new Map<string, { n: number; open: number; cents: number; states: Set<string> }>();
  for (const s of stale) {
    if (!s.owner) continue;
    const r = roll.get(s.owner) ?? { n: 0, open: 0, cents: 0, states: new Set<string>() };
    r.n++;
    if (!closed.has(s.status)) {
      r.open++;
      r.cents += s.cents;
      if (s.state) r.states.add(s.state);
    }
    roll.set(s.owner, r);
  }
  return rows.map((p) => {
    const r = roll.get(p.id);
    const sugg = suggestions.get(p.id) ?? [];
    const reasons = reviewReasons(p, sugg);
    return {
      id: p.id,
      canonicalName: p.canonicalName,
      aliases: p.aliases,
      itemCount: r?.n ?? 0,
      openItemCount: r?.open ?? 0,
      outstandingCents: r?.cents ?? 0,
      ownerStates: [...(r?.states ?? [])].sort(),
      mergeBasis: p.mergeBasis,
      mergeConfidence: p.mergeConfidence,
      reviewedBy: p.reviewedBy,
      reviewedAt: p.reviewedAt ? p.reviewedAt.toISOString() : null,
      reviewAction: p.reviewAction,
      needsReview: reasons.length > 0,
      reasons,
      suggestions: sugg,
    };
  });
}

export interface PayeeFilters {
  q?: string | null;
  state?: string | null;
  /** "review" = needs review, "human" = human-reviewed, "multi" = has aliases. */
  show?: string | null;
  basis?: string | null;
}

export function filterPayees(rows: readonly PayeeRow[], f: PayeeFilters): PayeeRow[] {
  const q = f.q?.trim().toLowerCase();
  const out = rows.filter((r) => {
    if (q && !(r.canonicalName.toLowerCase().includes(q) || r.aliases.some((a) => a.toLowerCase().includes(q)))) return false;
    if (f.state && !r.ownerStates.includes(f.state.toUpperCase())) return false;
    if (f.basis && r.mergeBasis !== f.basis) return false;
    if (f.show === "review" && !r.needsReview) return false;
    if (f.show === "human" && r.mergeBasis !== "human") return false;
    if (f.show === "aliases" && r.aliases.length === 0) return false;
    if (f.show === "items" && r.itemCount === 0) return false;
    return true;
  });
  // Attention first, then biggest exposure, then name.
  return out.sort(
    (a, b) =>
      Number(b.needsReview) - Number(a.needsReview) ||
      b.outstandingCents - a.outstandingCents ||
      a.canonicalName.localeCompare(b.canonicalName),
  );
}

export interface PayeeItemRow {
  staleItemId: string;
  checkNumber: string | null;
  payeeNameRaw: string;
  amountCents: number;
  ownerState: string | null;
  status: string;
}

export interface PayeeDetail {
  payee: PayeeRow;
  items: PayeeItemRow[];
  /** Raw ledger names on lines linked to this payee, with line counts (what a split can pull out). */
  rawNames: Array<{ name: string; lines: number }>;
}

export async function getPayeeDetail(db: Db, companyId: string, id: string): Promise<PayeeDetail | null> {
  const all = await listPayees(db, companyId);
  const payee = all.find((p) => p.id === id);
  if (!payee) return null;
  const lines = await db
    .select()
    .from(ledgerItems)
    .where(and(eq(ledgerItems.companyId, companyId), eq(ledgerItems.payeeId, id)));
  const staleRows = lines.length
    ? await db
        .select()
        .from(staleItems)
        .where(and(eq(staleItems.companyId, companyId), inArray(staleItems.ledgerItemId, lines.map((l) => l.id))))
    : [];
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const items = staleRows
    .map((s) => ({
      staleItemId: s.id,
      checkNumber: lineById.get(s.ledgerItemId)?.referenceNumber ?? null,
      payeeNameRaw: lineById.get(s.ledgerItemId)?.payeeNameRaw ?? "",
      amountCents: s.amountCents,
      ownerState: s.ownerState,
      status: s.status,
    }))
    .sort((a, b) => b.amountCents - a.amountCents);
  const names = new Map<string, number>();
  for (const l of lines) names.set(l.payeeNameRaw.trim(), (names.get(l.payeeNameRaw.trim()) ?? 0) + 1);
  return { payee, items, rawNames: [...names].map(([name, n]) => ({ name, lines: n })).sort((a, b) => a.name.localeCompare(b.name)) };
}
