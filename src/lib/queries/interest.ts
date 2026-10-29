import type { Db } from "@/db/client";
import { compare, type IsoDate } from "@/lib/dates";
import { tryLoadRules } from "@/lib/rules/load";
import { computeAuditInterest } from "@/lib/rules/engine";
import { money, today } from "./common";
import { loadOpenRows } from "./items";
import type { InterestExposure } from "./schemas";

const UNVERIFIED_LABEL = "Estimate; rule unverified";
const ESTIMATE_LABEL = "Estimate";

/** Statuses where a report has already been filed (or the item is closed) so no late-report interest accrues. */
const FILED = new Set(["reported", "remitted", "resolved_paid"]);

/**
 * Per-state estimate of interest owed if open items were reported late, via the rules engine.
 * Unknown rules or missing due dates carry through as UNKNOWN (null), never a guess.
 */
export async function getAuditInterestExposure(db: Db, companyId: string): Promise<InterestExposure> {
  const asOf: IsoDate = await today(db, companyId);
  const rows = (await loadOpenRows(db, companyId)).filter((r) => !FILED.has(r.status));
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
    const result = computeAuditInterest(
      items.map((r) => ({ id: r.id, amountCents: r.amountCents, reportDueDate: (r.reportDueDate ?? undefined) as IsoDate | undefined })),
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
