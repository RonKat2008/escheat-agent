import type { Db } from "@/db/client";
import { compare, type IsoDate } from "@/lib/dates";
import { tryLoadRules } from "@/lib/rules/load";
import { accrualStart } from "@/lib/interest/accrual-start";
import { computeAuditInterest } from "@/lib/rules/engine";
import { money, today } from "./common";
import { loadOpenRows } from "./items";
import type { InterestExposure } from "./schemas";

const UNVERIFIED_LABEL = "Estimate; rule unverified";
const ESTIMATE_LABEL = "Estimate";

/** Statuses where the report is already filed: they accrue from the remit due date instead (R4-06), when the rule says so. */
const REPORTED = "reported";

/**
 * Per-state estimate of interest owed if open items were reported late, via the rules engine.
 * Unknown rules or missing due dates carry through as UNKNOWN (null), never a guess.
 */
export async function getAuditInterestExposure(db: Db, companyId: string): Promise<InterestExposure> {
  const asOf: IsoDate = await today(db, companyId);
  const rows = await loadOpenRows(db, companyId);
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.ownerState ?? "UNKNOWN";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const byState: InterestExposure["byState"] = [];
  for (const [state, items] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const principal = items.reduce((a, r) => a + r.amountCents, 0);
    const loaded = state === "UNKNOWN" ? null : tryLoadRules(state);
    if (!loaded) {
      byState.push({
        state,
        itemCount: items.length,
        principal: money(principal),
        status: "unknown",
        interest: null,
        verified: false,
        label: UNVERIFIED_LABEL,
        ruleVersion: null,
        sources: [],
        notes: [state === "UNKNOWN" ? "Owner state unknown; interest cannot be estimated" : `No rule file for ${state}; interest is UNKNOWN`],
      });
      continue;
    }
    // Reported items accrue from the remit due date only if the sourced rule says late payment starts interest;
    // otherwise they are UNKNOWN once past due and skipped while not yet due (never a guessed figure).
    const dated = items.map((r) => {
      if (r.status !== REPORTED) return { r, start: (r.reportDueDate ?? undefined) as IsoDate | undefined | "unsupported" | null };
      return { r, start: accrualStart({ reportDue: null, remitDue: (r.remitDueDate ?? undefined) as IsoDate | undefined }, loaded.file) };
    });
    const unsupportedPastDue = dated.some((x) => x.start === "unsupported" && x.r.remitDueDate && compare(x.r.remitDueDate as IsoDate, asOf) < 0);
    const usable = dated.filter((x) => x.start !== "unsupported");
    const result = unsupportedPastDue
      ? {
          status: "unknown" as const,
          totalCents: null,
          verified: false,
          sources: [],
          notes: [`${state} interest rule does not say a late payment starts interest; not estimated for reported items`],
        }
      : computeAuditInterest(
          usable.map((x) => ({ id: x.r.id, amountCents: x.r.amountCents, reportDueDate: (x.start ?? undefined) as IsoDate | undefined })),
          loaded.file,
          asOf,
        );
    byState.push({
      state,
      itemCount: items.length,
      principal: money(principal),
      status: result.status,
      interest: result.totalCents === null ? null : money(result.totalCents),
      verified: result.verified,
      label: result.verified ? ESTIMATE_LABEL : UNVERIFIED_LABEL,
      ruleVersion: loaded.file.version,
      sources: result.sources.map((s) => ({ url: s.url, title: s.title, quote: s.quote })),
      notes: result.notes,
    });
  }
  const anyUnknown = byState.some((s) => s.status === "unknown");
  const totalCents = anyUnknown ? null : byState.reduce((a, s) => a + (s.interest?.cents ?? 0), 0);
  const anyUnverified = byState.some((s) => !s.verified);
  return {
    asOf,
    label: anyUnverified ? UNVERIFIED_LABEL : ESTIMATE_LABEL,
    totalCents,
    total: totalCents === null ? null : money(totalCents),
    anyUnknown,
    anyUnverified,
    byState: byState.sort((a, b) => compare(a.state as IsoDate, b.state as IsoDate)),
  };
}
