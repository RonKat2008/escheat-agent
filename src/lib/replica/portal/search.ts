import { z } from "zod";
import searchRecordsFile from "../../../../fixtures/replica/search-records.json";
import type { ReplicaState } from "./portals";
import { REPLICA_STATES } from "./portals";

export interface SearchRecord {
  propertyId: string;
  state: ReplicaState;
  ownerName: string;
  city: string;
  reportedBy: string;
  propertyType: string;
  amountCents: number;
}

export const searchQuerySchema = z.object({
  name: z.string().trim().min(2, "Enter at least 2 characters of the owner name.").max(120),
  city: z.string().trim().max(80).optional(),
});

/* ------------------------------------------------------------ fixture loading */

/** Tolerant field readers: the fixture file is written by another lane. */
const pick = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};

function toCents(o: Record<string, unknown>): number | null {
  const cents = pick(o, "amountCents", "amount_cents", "cents");
  if (typeof cents === "number" && Number.isFinite(cents)) return Math.round(cents);
  const amount = pick(o, "amount", "cashReported", "value");
  if (typeof amount === "number") return Math.round(amount * 100);
  if (typeof amount === "string") {
    const n = Number(amount.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }
  return null;
}

export function normalizeRecord(raw: unknown, fallbackState?: string): SearchRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const state = String(pick(o, "state_held", "state", "stateCode", "portal") ?? fallbackState ?? "").toLowerCase();
  const parsedState = z.enum(REPLICA_STATES).safeParse(state.slice(0, 2));
  const ownerName = pick(o, "ownerName", "owner_name", "owner", "name");
  const propertyId = pick(o, "propertyId", "property_id", "id");
  const cents = toCents(o);
  if (!parsedState.success || typeof ownerName !== "string" || propertyId === undefined || cents === null) {
    return null;
  }
  return {
    propertyId: String(propertyId),
    state: parsedState.data,
    ownerName,
    city: String(pick(o, "city", "ownerCity", "owner_city", "addressCity") ?? ""),
    reportedBy: String(pick(o, "reportedBy", "reported_by", "holderName", "holder") ?? ""),
    propertyType: String(pick(o, "propertyType", "property_type", "type", "propertyCode") ?? ""),
    amountCents: cents,
  };
}

/** Accepts [..], {records:[..]}, {records:{CA:[..],..}} or {CA:[..], DE:[..], TX:[..]}. */
export function normalizeRecordFile(json: unknown): SearchRecord[] {
  const out: SearchRecord[] = [];
  const push = (list: unknown, st?: string) => {
    if (!Array.isArray(list)) return;
    for (const r of list) {
      const n = normalizeRecord(r, st);
      if (n) out.push(n);
    }
  };
  if (Array.isArray(json)) push(json);
  else if (typeof json === "object" && json !== null) {
    const o = json as Record<string, unknown>;
    const records = o.records;
    if (Array.isArray(records)) push(records);
    else if (typeof records === "object" && records !== null) {
      for (const [k, v] of Object.entries(records)) push(v, k);
    }
    for (const [k, v] of Object.entries(o)) if (k !== "records") push(v, k);
  }
  return out;
}

let cache: SearchRecord[] | undefined;
/** Imported statically so the fixture is bundled (no runtime filesystem access in deployments). */
export function loadSearchRecords(): SearchRecord[] {
  cache ??= normalizeRecordFile(searchRecordsFile);
  return cache;
}

/* ------------------------------------------------------------------ matching */

const CORP_SUFFIXES = new Set(["INC", "INCORPORATED", "LLC", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "THE"]);

export function normalizeName(s: string): string {
  return s
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

const significantTokens = (s: string): string[] => {
  const all = normalizeName(s).split(" ").filter(Boolean);
  const sig = all.filter((t) => !CORP_SUFFIXES.has(t));
  return sig.length > 0 ? sig : all;
};

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function tokenMatches(q: string, t: string): boolean {
  if (q === t || t.startsWith(q)) return true;
  return q.length >= 5 && t.length >= 5 && editDistanceAtMostOne(q, t);
}

/** Case/punctuation-insensitive contains, else every significant query token matches some owner token. */
export function nameMatches(query: string, ownerName: string): boolean {
  const q = normalizeName(query);
  if (!q) return false;
  const o = normalizeName(ownerName);
  if (o.includes(q)) return true;
  const ownerTokens = significantTokens(ownerName);
  return significantTokens(query).every((qt) => ownerTokens.some((ot) => tokenMatches(qt, ot)));
}

export function searchRecords(
  state: ReplicaState,
  query: { name: string; city?: string },
  records: SearchRecord[] = loadSearchRecords(),
): SearchRecord[] {
  const { name, city } = searchQuerySchema.parse(query);
  const cityNorm = city ? normalizeName(city) : "";
  return records
    .filter((r) => r.state === state)
    .filter((r) => nameMatches(name, r.ownerName))
    .filter((r) => !cityNorm || normalizeName(r.city).includes(cityNorm))
    .sort((a, b) => a.ownerName.localeCompare(b.ownerName) || a.propertyId.localeCompare(b.propertyId));
}

export function findRecord(
  state: ReplicaState,
  propertyId: string,
  records: SearchRecord[] = loadSearchRecords(),
): SearchRecord | null {
  return records.find((r) => r.state === state && r.propertyId === propertyId) ?? null;
}
