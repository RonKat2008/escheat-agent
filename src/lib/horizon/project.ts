/**
 * Pre-stale Horizon projection (pure). An outstanding payment that is NOT yet business-stale is projected forward:
 * when it crosses the stale threshold (business policy, STALE_THRESHOLD_DAYS) and, from the rules engine, when it would
 * become presumed abandoned in its owner's state. The owner state is PROVISIONAL: it is read from the payee address only
 * (no classifier, no model). A missing or unsupported state yields UNKNOWN dates with a reason, never a guess.
 */
import type { PropertyType } from "@/db/schema";
import { addDays, diffDays, type IsoDate } from "@/lib/dates";
import { computeItemTimeline } from "@/lib/pipeline/compute";
import { daysUntilStaleAt } from "./phase";

export interface HorizonSource {
  ledgerItemId: string;
  checkNumber: string | null;
  payeeName: string;
  propertyType: PropertyType;
  amountCents: number;
  issueDate: string;
  lastActivityDate: string | null;
  /** ledger_items.state: the payee ADDRESS state, as ingested. */
  addressState: string | null;
  /** Reconciliation age (days from issue to the demo clock's today). */
  ageDays: number;
}

export interface ProjectedDates {
  presumedAbandoned: string | null;
  reportDue: string | null;
  remitDue: string | null;
  ruleVersion: string | null;
  /** Some rule value behind these dates is unverified (UNVERIFIED badge stays). */
  unverified: boolean;
}

export interface HorizonItem extends HorizonSource {
  /** Days until the item is business-stale (stale the day AFTER the threshold, as detection's isStale: age > threshold). */
  daysUntilStale: number;
  /** First day the item counts as stale. */
  staleOn: string;
  /** Provisional owner state from the address only; null = unknown. */
  ownerState: string | null;
  /** Engine dates for the provisional classification; null when unknown (with `unknownReason`). */
  dates: ProjectedDates | null;
  unknownReason: string | null;
  /** Days from issue to presumed abandoned (for the radar); null when unknown. */
  presumedAtAgeDays: number | null;
}

export interface ProjectContext {
  thresholdDays: number;
  /** companies.fiscal_year_end (MM-DD). */
  holderFiscalYearEnd: string;
}

const STATE_CODE = /^[A-Z]{2}$/;

/** "ca " -> "CA"; anything that is not a two-letter code -> null (unknown, never inferred). */
export function provisionalOwnerState(addressState: string | null | undefined): string | null {
  const s = addressState?.trim().toUpperCase() ?? "";
  return STATE_CODE.test(s) ? s : null;
}

export { isStaleAtAge, daysUntilStaleAt, phaseAtAge, type HorizonPhase } from "./phase";

export function projectItem(src: HorizonSource, ctx: ProjectContext): HorizonItem {
  const ownerState = provisionalOwnerState(src.addressState);
  const lastActivity = (src.lastActivityDate ?? src.issueDate) as IsoDate;
  const tl = computeItemTimeline({
    ownerState,
    propertyType: src.propertyType,
    lastActivityDate: lastActivity,
    amountCents: src.amountCents,
    holderFiscalYearEnd: ctx.holderFiscalYearEnd,
  });
  const presumed = tl.dates.presumedAbandonedDate;
  const known = tl.summary.needsRuleReason === null && presumed !== null;
  return {
    ...src,
    ownerState,
    daysUntilStale: daysUntilStaleAt(src.ageDays, ctx.thresholdDays),
    staleOn: addDays(src.issueDate as IsoDate, ctx.thresholdDays + 1),
    dates: known
      ? {
          presumedAbandoned: presumed,
          reportDue: tl.dates.reportDueDate,
          remitDue: tl.dates.remitDueDate,
          ruleVersion: tl.dates.ruleVersion,
          unverified: tl.dates.dependsOnUnverified,
        }
      : null,
    unknownReason: known ? null : (tl.summary.needsRuleReason ?? "The rules engine returned no presumed-abandoned date for this item."),
    presumedAtAgeDays: known ? diffDays(src.issueDate as IsoDate, presumed as IsoDate) : null,
  };
}

/** Soonest-to-stale first, then larger amounts first, then check number (stable). */
export function sortWorklist(items: readonly HorizonItem[]): HorizonItem[] {
  return [...items].sort(
    (a, b) => a.daysUntilStale - b.daysUntilStale || b.amountCents - a.amountCents || (a.checkNumber ?? "").localeCompare(b.checkNumber ?? ""),
  );
}
