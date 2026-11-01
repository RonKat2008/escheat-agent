import { asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agentRuns, approvals, companies, ledgerItems, outreach, payees, staleItems } from "@/db/schema";
import type { IsoDate } from "@/lib/dates";
import { loadRules, pinRules } from "@/lib/rules/load";
import { describeDerivation, describeRoll } from "@/lib/rules/derivation";
import { computeTimeline, type DatedValue, type Timeline } from "@/lib/rules/engine";
import type { RuleFile } from "../../../rules/schema";
import { formatAddress, today } from "./common";
import { getStaleItemRow } from "./items";
import type { Explanation, TimelineEvent } from "./schemas";

const LABELS: Record<TimelineEvent["key"], string> = {
  presumed_abandoned: "Presumed abandoned (dormancy ends)",
  dd_window_start: "Due-diligence window opens",
  dd_window_end: "Due-diligence window closes",
  report_due: "Report due",
  remit_due: "Remittance due",
};

function loadRulesFor(state: string | null, version: string | null): { rules: RuleFile | null; note: string | null; pinned: boolean } {
  if (!state) return { rules: null, note: "Owner state is unknown, so no rule file applies", pinned: false };
  try {
    if (version) return { rules: pinRules(state, version).file, note: null, pinned: true };
  } catch (e) {
    try {
      return { rules: loadRules(state).file, note: `Pinned version ${version} unavailable (${(e as Error).message}); showing the current ${state} rule file`, pinned: false };
    } catch (e2) {
      return { rules: null, note: (e2 as Error).message, pinned: false };
    }
  }
  try {
    return { rules: loadRules(state).file, note: "Item has no pinned rule version; showing the current rule file", pinned: false };
  } catch (e) {
    return { rules: null, note: (e as Error).message, pinned: false };
  }
}

function pick(t: Timeline | null, key: TimelineEvent["key"], stage: string | null): DatedValue | null {
  if (!t) return null;
  switch (key) {
    case "presumed_abandoned":
      return t.presumedAbandoned;
    case "dd_window_start":
      return t.ddWindow.start;
    case "dd_window_end":
      return t.ddWindow.end;
    case "remit_due":
      return t.remitDue;
    case "report_due":
      return (t.reportStages.find((s) => s.name === stage) ?? t.reportStages[0])?.due ?? null;
  }
}

/** One citation per URL (F14): the first quote for a URL is kept; repeats of the same statute are dropped. */
function dedupeByUrl(sources: readonly { url: string; title: string; quote: string }[]): TimelineEvent["sources"] {
  const seen = new Set<string>();
  const out: TimelineEvent["sources"] = [];
  for (const s of sources) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    out.push({ url: s.url, title: s.title, quote: s.quote });
  }
  return out;
}

/**
 * Notes shown under a date. F15: an engine "unknown" reason is never printed under a date that resolved; when the
 * stored date differs from (or cannot be re-derived by) the current rules, say that instead.
 */
function notesFor(status: string, date: string | null, ev: DatedValue | null, matches: boolean): string[] {
  if (status === "unknown") return ev?.notes.length ? ev.notes : ["No date computed: a required rule value is missing (UNKNOWN, never guessed)"];
  if (!date || matches) return ev?.notes.filter((n) => !/^Rolled forward from /.test(n)) ?? [];
  if (ev?.status === "ok" && ev.date) return [`Stored date from the last recompute; the current rule file gives ${ev.date}. Recompute to update it.`];
  return ["Stored date from the last recompute; the current rule file cannot re-derive it, so treat it as provisional."];
}

export async function explainItem(db: Db, id: string): Promise<Explanation | null> {
  const [si] = await db.select().from(staleItems).where(eq(staleItems.id, id));
  if (!si) return null;
  const asOf = await today(db, si.companyId);
  const row = (await getStaleItemRow(db, id, asOf))!;
  const [li] = await db.select().from(ledgerItems).where(eq(ledgerItems.id, si.ledgerItemId));
  const [payee] = si.ownerPayeeId ? await db.select().from(payees).where(eq(payees.id, si.ownerPayeeId)) : [];
  const outreachRows = await db.select().from(outreach).where(eq(outreach.staleItemId, id)).orderBy(asc(outreach.createdAt));
  const subjects = [id, ...outreachRows.map((o) => o.id)];
  const approvalRows = await db.select().from(approvals).where(inArray(approvals.subjectId, subjects)).orderBy(asc(approvals.createdAt));
  const runs = await db.select().from(agentRuns).where(eq(agentRuns.staleItemId, id)).orderBy(desc(agentRuns.startedAt));
  const [company] = await db.select({ fiscalYearEnd: companies.fiscalYearEnd }).from(companies).where(eq(companies.id, si.companyId));

  const warnings: string[] = [];
  const { rules, note, pinned } = loadRulesFor(si.ownerState, si.ruleVersion);
  let engine: Timeline | null = null;
  if (rules && si.ownerState) {
    try {
      engine = computeTimeline(
        {
          propertyType: si.propertyType,
          lastActivityDate: (li?.lastActivityDate ?? li?.issueDate ?? si.staleSince) as IsoDate,
          amountCents: si.amountCents,
          ownerState: si.ownerState,
          // Same input the pipeline used to store the dates (F15: without it CA's fiscal-year-end stages read "unknown").
          ...(company ? { holderFiscalYearEnd: company.fiscalYearEnd } : {}),
          clockDates: {
            ...(li?.issueDate ? { issue_date: li.issueDate as IsoDate } : {}),
            ...(li?.lastActivityDate ? { last_owner_activity: li.lastActivityDate as IsoDate } : {}),
          },
        },
        rules,
      );
      warnings.push(...engine.warnings);
    } catch (e) {
      warnings.push(`Rules engine could not compute this timeline: ${(e as Error).message}`);
    }
  }

  const stored: Record<TimelineEvent["key"], string | null> = {
    presumed_abandoned: si.presumedAbandonedDate,
    dd_window_start: si.ddWindowStart,
    dd_window_end: si.ddWindowEnd,
    report_due: si.reportDueDate,
    remit_due: si.remitDueDate,
  };
  const timeline: TimelineEvent[] = (Object.keys(LABELS) as TimelineEvent["key"][]).map((key) => {
    const ev = pick(engine, key, si.reportStage);
    const date = stored[key] ?? ev?.date ?? null;
    const status = date ? "ok" : (ev?.status ?? "unknown");
    const matches = ev?.date != null && ev.date === date;
    if (ev?.date && stored[key] && ev.date !== stored[key]) {
      warnings.push(`${LABELS[key]}: stored ${stored[key]} differs from rules-engine ${ev.date}`);
    }
    // A derivation only explains the date it was computed for; a stored date the engine no longer produces gets none.
    const derivation = matches && ev?.derivation ? ev.derivation : null;
    return {
      key,
      label: LABELS[key],
      date,
      status,
      verified: status === "ok" && (matches ? ev!.verified : !si.dependsOnUnverified && Boolean(ev?.verified ?? true)),
      ruleVersion: ev?.ruleRefs[0]?.version ?? si.ruleVersion,
      rulePaths: ev?.ruleRefs.map((r) => r.path) ?? [],
      sources: dedupeByUrl(ev?.sources ?? []),
      notes: notesFor(status, date, ev, matches),
      derivation: derivation ? describeDerivation(derivation, { includeRoll: false }) : [],
      roll: derivation?.roll ? describeRoll(derivation.roll) : null,
    };
  });

  return {
    asOf,
    item: { ...row, staleSince: si.staleSince as IsoDate, reportStage: si.reportStage, classification: si.classification },
    ledger: {
      referenceNumber: li?.referenceNumber ?? null,
      issueDate: li?.issueDate ?? row.issueDate,
      lastActivityDate: li?.lastActivityDate ?? null,
      status: li?.status ?? "unknown",
      memo: li?.memo ?? null,
      address: li ? formatAddress(li) : "",
      source: li?.source ?? "unknown",
    },
    payee: payee
      ? {
          id: payee.id,
          canonicalName: payee.canonicalName,
          aliases: payee.aliases,
          address: formatAddress(payee),
          mergeBasis: payee.mergeBasis,
          mergeConfidence: payee.mergeConfidence,
        }
      : null,
    rules: { state: si.ownerState, pinnedVersion: pinned ? si.ruleVersion : null, loaded: rules !== null, note },
    timeline,
    warnings: [...new Set(warnings)],
    outreach: outreachRows.map((o) => ({
      id: o.id,
      channel: o.channel,
      status: o.status,
      toAddress: o.toAddress,
      subject: o.subject,
      sentAt: o.sentAt?.toISOString() ?? null,
      createdAt: o.createdAt.toISOString(),
    })),
    approvals: approvalRows.map((a) => ({
      id: a.id,
      action: a.action,
      subjectId: a.subjectId,
      approvedBy: a.approvedBy,
      approvedAt: a.approvedAt?.toISOString() ?? null,
      consumedAt: a.consumedAt?.toISOString() ?? null,
    })),
    agentRuns: runs.map((r) => ({
      id: r.id,
      agent: r.agent,
      model: r.model,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      error: r.error,
    })),
  };
}
