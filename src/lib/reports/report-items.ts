/**
 * Which stale items a stored report covers. The report row has no item list, but its NAUPA file is the record of
 * exactly what was filed: one property record per named item (check number + amount) and one aggregate record per
 * aggregate code (count in the description + summed amount). Matching the file back to the company's items lets the
 * evidence pack be rebuilt after filing moved those items from To Report to Reported, and keeps items that reached
 * To Report after the file was generated out of it. Every record must match exactly, or nothing is returned.
 */
import type { RuleFile } from "../../../rules/schema";
import { aggregateCodeFor, sanitizeAscii } from "./layout";
import { parseNaupaReport, type ParsedProperty } from "./parse";

/** Field width of PROP-CHECK-NUMBER (layout.ts); the writer truncates longer references to it. */
const CHECK_NUMBER_WIDTH = 20;
const AGGREGATE_COUNT = /AGGREGATE OF (\d+) ITEMS/;

export interface FiledCandidate {
  id: string;
  referenceNumber: string | null;
  amountCents: number;
  propertyType: string;
  lastActivityDate: string | null;
}

export type ReportItemMatch = { ok: true; ids: string[] } | { ok: false; reason: string };

const checkKey = (ref: string | null): string => sanitizeAscii(ref ?? "").slice(0, CHECK_NUMBER_WIDTH).trimEnd();

/** The aggregate code an item would be rolled into under the rule file's threshold, or null when it is reported by name. */
function aggregateCodeOf(c: FiledCandidate, rules: RuleFile): string | null {
  const rule = rules.propertyTypes[c.propertyType as keyof RuleFile["propertyTypes"]];
  const code = rule?.naupaCode.value ?? null;
  const threshold = rule?.aggregateThresholdCents.value ?? null;
  if (!code || threshold === null || c.amountCents >= threshold) return null;
  return aggregateCodeFor(code);
}

function matchNamed(p: ParsedProperty, pool: readonly FiledCandidate[], taken: ReadonlySet<string>): FiledCandidate | string {
  if (!p.checkNumber) return `property ${p.sequence} has no check number to match`;
  const hits = pool.filter((c) => !taken.has(c.id) && c.amountCents === p.amountReportedCents && checkKey(c.referenceNumber) === p.checkNumber);
  if (hits.length === 1) return hits[0]!;
  return hits.length === 0
    ? `property ${p.sequence} (check ${p.checkNumber}) matches no item`
    : `property ${p.sequence} (check ${p.checkNumber}) matches ${hits.length} items`;
}

function matchAggregate(p: ParsedProperty, pool: readonly FiledCandidate[], taken: ReadonlySet<string>, rules: RuleFile): FiledCandidate[] | string {
  const count = Number(AGGREGATE_COUNT.exec(p.description)?.[1] ?? NaN);
  if (!Number.isInteger(count)) return `aggregate property ${p.sequence} does not state its item count`;
  const hits = pool.filter(
    (c) =>
      !taken.has(c.id) &&
      aggregateCodeOf(c, rules) === p.propertyType &&
      (!p.lastActivityDate || !c.lastActivityDate || c.lastActivityDate <= p.lastActivityDate),
  );
  const cents = hits.reduce((s, c) => s + c.amountCents, 0);
  if (hits.length !== count || cents !== p.amountReportedCents) {
    return `aggregate ${p.propertyType} lists ${count} items, ${hits.length} candidate items match`;
  }
  return hits;
}

/** Ids of the items the stored report file lists, in file order; a reason instead when any record cannot be matched exactly. */
export function matchFiledItems(fileText: string, pool: readonly FiledCandidate[], rules: RuleFile): ReportItemMatch {
  const { properties } = parseNaupaReport(fileText);
  const taken = new Set<string>();
  const ids: string[] = [];
  // Named records first: an aggregate must not swallow an item the file lists by check number.
  for (const p of properties.filter((x) => !x.isAggregate)) {
    const hit = matchNamed(p, pool, taken);
    if (typeof hit === "string") return { ok: false, reason: hit };
    taken.add(hit.id);
    ids.push(hit.id);
  }
  for (const p of properties.filter((x) => x.isAggregate)) {
    const hits = matchAggregate(p, pool, taken, rules);
    if (typeof hits === "string") return { ok: false, reason: hits };
    for (const h of hits) {
      taken.add(h.id);
      ids.push(h.id);
    }
  }
  return { ok: true, ids };
}
