/**
 * R8 Escheat Ledger: every stale item as dated liability movements, in integer cents. Pure (the loader is
 * src/lib/queries/ledger.ts).
 *
 * Recognition policy: an item is recognized as a liability on its `stale_since` date (the app's 180-day business
 * threshold, not law). It leaves the liability once, on the demo date it was settled:
 *  - remitted: the date the person recorded paying the state (classification.remittance.remittedOn, written by
 *    src/lib/close-out/remittance.ts);
 *  - resolved_paid with a bank clear on or after it went stale: "cleared late by bank", on the clear date;
 *  - other resolved_paid: "resolved with owner", on the demo date of the resolution.
 *
 * Dating a resolution: src/lib/stale/resolve.ts stores the demo day itself (classification.resolution.at, and
 * resolved_at = that day at 00:00 UTC). Reading that day is exact and survives later clock jumps; running a
 * demo-day-at-midnight value through demoDayAt would re-date it to whatever day the clock shows when the real instant
 * passes. demoDayAt (clock-history.ts) is used only for a genuine real-time timestamp (legacy rows).
 */
import { demoDayAt, type ClockStep } from "@/lib/clock-history";
import { isIsoDate } from "@/lib/dates";
import type { PropertyType } from "./accounts";

export type MovementKind = "identified" | "resolved" | "cleared_late" | "remitted";
export const SETTLEMENT_KINDS: readonly MovementKind[] = ["resolved", "cleared_late", "remitted"];

/** One stale item as the loader reads it. */
export interface LedgerItem {
  id: string;
  /** Owner state, or null when unknown (grouped as "UNKNOWN"). */
  state: string | null;
  propertyType: PropertyType;
  amountCents: number;
  status: string;
  /** YYYY-MM-DD demo date the item became stale (recognized). */
  staleSince: string;
  /** resolved_at as an ISO timestamp, or null. */
  resolvedAt: string | null;
  classification: unknown;
  /** Earliest bank clear on/after staleSince for the item's ledger row, or null. */
  lateClearDate: string | null;
  payee: string;
  checkNumber: string | null;
  dependsOnUnverified: boolean;
}

export interface Movement {
  itemId: string;
  kind: MovementKind;
  date: string;
  state: string;
  propertyType: PropertyType;
  /** Always positive; the kind says which way it moves the liability. */
  amountCents: number;
  payee: string;
  checkNumber: string | null;
  dependsOnUnverified: boolean;
  /** Remittances only: the report it paid and the reference typed by the person. */
  reportId?: string;
  reference?: string | null;
  /** True when no settlement date was recorded and the item's stale date was used instead. */
  undated?: boolean;
}

export const UNKNOWN_STATE = "UNKNOWN";

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const MIDNIGHT_UTC = /^(\d{4}-\d{2}-\d{2})T00:00:00(\.000)?(Z|\+00:00)$/;

/** The demo date stored by a writer that records the demo day itself (resolved_at = day at 00:00 UTC). */
function storedDay(resolvedAt: string | null, history: readonly ClockStep[], today: string): string | null {
  if (!resolvedAt) return null;
  const m = MIDNIGHT_UTC.exec(resolvedAt);
  if (m) return m[1]!;
  return demoDayAt(resolvedAt, history, today);
}

/** The remittance record written by recordRemittance, when present and well formed. */
export function remittanceOf(classification: unknown): { reportId: string; remittedOn: string; reference: string | null } | null {
  const r = obj(obj(classification)?.remittance);
  if (!r || typeof r.reportId !== "string" || !isIsoDate(r.remittedOn)) return null;
  return { reportId: r.reportId, remittedOn: r.remittedOn, reference: typeof r.reference === "string" ? r.reference : null };
}

function resolutionDay(item: LedgerItem, history: readonly ClockStep[], today: string): string | null {
  const at = obj(obj(item.classification)?.resolution)?.at;
  if (isIsoDate(at)) return at;
  return storedDay(item.resolvedAt, history, today);
}

/** A settlement is never dated before the item was recognized (the liability cannot go negative per item). */
const notBefore = (date: string, floor: string): string => (date < floor ? floor : date);

/** The item's movements: one `identified`, plus at most one settlement. */
export function itemMovements(item: LedgerItem, history: readonly ClockStep[], today: string): Movement[] {
  const base = {
    itemId: item.id,
    state: item.state ?? UNKNOWN_STATE,
    propertyType: item.propertyType,
    amountCents: item.amountCents,
    payee: item.payee,
    checkNumber: item.checkNumber,
    dependsOnUnverified: item.dependsOnUnverified,
  };
  const out: Movement[] = [{ ...base, kind: "identified", date: item.staleSince }];
  if (item.status === "remitted") {
    const rec = remittanceOf(item.classification);
    const day = rec?.remittedOn ?? storedDay(item.resolvedAt, history, today);
    out.push({
      ...base,
      kind: "remitted",
      date: notBefore(day ?? item.staleSince, item.staleSince),
      reportId: rec?.reportId,
      reference: rec?.reference ?? null,
      ...(day ? {} : { undated: true }),
    });
  } else if (item.status === "resolved_paid") {
    if (item.lateClearDate && item.lateClearDate >= item.staleSince) {
      out.push({ ...base, kind: "cleared_late", date: item.lateClearDate });
    } else {
      const day = resolutionDay(item, history, today);
      out.push({ ...base, kind: "resolved", date: notBefore(day ?? item.staleSince, item.staleSince), ...(day ? {} : { undated: true }) });
    }
  }
  return out;
}

export function allMovements(items: readonly LedgerItem[], history: readonly ClockStep[], today: string): Movement[] {
  return items.flatMap((i) => itemMovements(i, history, today));
}
