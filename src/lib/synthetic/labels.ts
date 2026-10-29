/**
 * Local labeling helpers. These exist ONLY to assert generator / eval-fixture invariants;
 * the production engines live in src/lib/recon and src/lib/rules.
 *
 * Owner-state priority rule (as coded here, see fixtures/eval/README.md):
 *   1. Military (APO/FPO/DPO, AA/AE/AP) or non-US (Canadian/other foreign) address -> NOT a state.
 *   2. Explicit state field (abbreviation, name, common variant, or typo of a full name).
 *   3. State found at the end of the address line or city field.
 *   4. State implied by the ZIP code prefix.
 *   5. Otherwise the holder's incorporation state (DE).
 */
import {
  CANADIAN_PROVINCES,
  MILITARY_STATE_CODES,
  isMilitaryZip,
  normalizeStateToken,
  normalizeZip,
  zipToState,
} from "./states";
import {
  HOLDER_INCORPORATION_STATE,
  STALE_THRESHOLD_DAYS,
  type ClearRow,
  type LedgerRow,
  type SynthPropertyType,
} from "./model";
import { daysBetween } from "./dates";

export interface AddressFields {
  payee_address: string;
  payee_city: string;
  payee_state: string;
  payee_zip: string;
}

export interface OwnerStateResult {
  owner_state: string;
  owner_state_basis: "address" | "incorporation";
  reason: string;
}

const PLACEHOLDERS = new Set(["n/a", "na", "none", "null", "unknown", "-", "--", "tbd"]);
const FOREIGN_WORDS =
  /\b(canada|mexico|united kingdom|u\.?k\.?|england|scotland|germany|france|australia|india|japan|china|ireland|brazil|netherlands|spain|italy)\b/i;
const CANADIAN_POSTAL = /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/i;
const MIL_WORDS = /\b(APO|FPO|DPO)\b/i;

function clean(v: string): string {
  const t = v.replace(/\s+/g, " ").trim();
  return PLACEHOLDERS.has(t.toLowerCase()) ? "" : t;
}

function stripTrailingZip(text: string): { rest: string; hadZip: boolean } {
  const m = /[\s,]*\d{5}(?:-\d{4})?\s*$/.exec(text);
  return m ? { rest: text.slice(0, m.index), hadZip: true } : { rest: text, hadZip: false };
}

/** State at the end of a free-text field, or null. Conservative about bare 2-letter tokens. */
export function trailingState(text: string, field: "address" | "city"): string | null {
  const { rest, hadZip } = stripTrailingZip(clean(text));
  const body = rest.replace(/[.,\s]+$/, "");
  if (!body) return null;
  const segments = body.split(",").map((s) => s.trim());
  const last = segments[segments.length - 1] ?? "";
  const hasComma = segments.length > 1;
  const words = last.split(/\s+/);
  const candidates = [last];
  if (words.length > 1) candidates.push(words.slice(-2).join(" "), words[words.length - 1] ?? "");
  for (const cand of candidates) {
    const isTwoLetter = /^[A-Za-z]{2}\.?$/.test(cand);
    // Street suffixes like "CT"/"LN" make bare codes risky in street lines: need a comma or ZIP.
    if (isTwoLetter && field === "address" && !hasComma && !hadZip) continue;
    // A lone word such as "Washington" is a city name, not a state.
    if (!isTwoLetter && words.length === 1 && !hasComma) continue;
    const code = normalizeStateToken(cand);
    if (code) return code;
  }
  return null;
}

export function isMilitary(a: AddressFields): boolean {
  const state = clean(a.payee_state).toUpperCase().replace(/\./g, "");
  if (MILITARY_STATE_CODES.has(state)) return true;
  const text = [a.payee_address, a.payee_city].map(clean).join(" ");
  if (MIL_WORDS.test(text)) return true;
  return !state && isMilitaryZip(clean(a.payee_zip)) && !trailingState(a.payee_city, "city");
}

export function isForeign(a: AddressFields): boolean {
  const state = clean(a.payee_state).toUpperCase().replace(/\./g, "");
  if (CANADIAN_PROVINCES.has(state)) return true;
  const joined = [a.payee_address, a.payee_city, a.payee_state, a.payee_zip].map(clean).join(" | ");
  if (FOREIGN_WORDS.test(joined) || CANADIAN_POSTAL.test(joined)) return true;
  const tail = /,\s*([A-Z]{2})\.?\s*$/.exec(clean(a.payee_city)) ?? /,\s*([A-Z]{2})\.?\s*$/.exec(clean(a.payee_address));
  return Boolean(tail && CANADIAN_PROVINCES.has(tail[1] as string));
}

export function resolveOwnerState(
  a: AddressFields,
  holderState: string = HOLDER_INCORPORATION_STATE,
): OwnerStateResult {
  const fallback = (reason: string): OwnerStateResult => ({
    owner_state: holderState,
    owner_state_basis: "incorporation",
    reason,
  });
  if (isMilitary(a)) return fallback("military address is not a state");
  if (isForeign(a)) return fallback("non-US address");
  const hit = (code: string, reason: string): OwnerStateResult => ({
    owner_state: code,
    owner_state_basis: "address",
    reason,
  });

  const fromField = normalizeStateToken(clean(a.payee_state), { fuzzy: true, anyCaseCode: true });
  if (fromField) return hit(fromField, "state field");
  const fromCity = trailingState(a.payee_city, "city");
  if (fromCity) return hit(fromCity, "state in city field");
  const fromLine = trailingState(a.payee_address, "address");
  if (fromLine) return hit(fromLine, "state in address line");

  const zipCandidates = [clean(a.payee_zip), /\b\d{5}(?:-\d{4})?\s*$/.exec(clean(a.payee_address))?.[0] ?? ""];
  for (const z of zipCandidates) {
    if (!z || !normalizeZip(z)) continue;
    const s = zipToState(z);
    if (s) return hit(s, "zip prefix");
  }
  return fallback("no determinable US state");
}

const PAYROLL_MEMO = /payroll|wages?\b|salary|paycheck|net pay|bonus|commission|final pay/i;
const REFUND_MEMO = /refund|rebate|overpayment|credit/i;
const UNAPPLIED_MEMO = /unapplied|on account|deposit|prepayment|payment received/i;

/** Property-type labeling rule: direct kinds map to themselves; generic kinds use the memo. */
export function classifyPropertyType(kind: string, memo: string): SynthPropertyType {
  if (
    kind === "vendor_check" ||
    kind === "payroll_check" ||
    kind === "customer_credit" ||
    kind === "unapplied_cash"
  ) {
    return kind;
  }
  if (kind === "credit") return UNAPPLIED_MEMO.test(memo) ? "unapplied_cash" : "customer_credit";
  if (PAYROLL_MEMO.test(memo)) return "payroll_check";
  if (REFUND_MEMO.test(memo)) return "customer_credit";
  return "vendor_check";
}

export interface StaleInput {
  issue_date: string;
  voided?: boolean;
  cleared_date: string | null;
}

/** Stale = not voided, no clear on/before the anchor, and anchor - issue > threshold days. */
export function isStaleAt(
  item: StaleInput,
  anchor: string,
  thresholdDays: number = STALE_THRESHOLD_DAYS,
): boolean {
  if (item.voided) return false;
  if (item.cleared_date !== null && item.cleared_date <= anchor) return false;
  return daysBetween(item.issue_date, anchor) > thresholdDays;
}

export function clearedDateIndex(clears: readonly ClearRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of clears) {
    const prev = m.get(c.check_number);
    if (prev === undefined || c.cleared_date < prev) m.set(c.check_number, c.cleared_date);
  }
  return m;
}

export interface DemoStats {
  staleCount: number;
  staleTotalCents: number;
  byOwnerState: Record<string, number>;
  staleRows: LedgerRow[];
}

export function computeDemoStats(
  ledger: readonly LedgerRow[],
  clears: readonly ClearRow[],
  anchor: string,
): DemoStats {
  const idx = clearedDateIndex(clears);
  const staleRows = ledger.filter((r) =>
    isStaleAt({ issue_date: r.issue_date, voided: r.voided, cleared_date: idx.get(r.number) ?? null }, anchor),
  );
  const byOwnerState: Record<string, number> = {};
  for (const r of staleRows) {
    const { owner_state } = resolveOwnerState(r);
    byOwnerState[owner_state] = (byOwnerState[owner_state] ?? 0) + 1;
  }
  return {
    staleCount: staleRows.length,
    staleTotalCents: staleRows.reduce((s, r) => s + r.amount_cents, 0),
    byOwnerState,
    staleRows,
  };
}

