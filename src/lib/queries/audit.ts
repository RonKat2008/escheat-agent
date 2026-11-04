/**
 * Audit Drill data (read-only). Draws the deterministic sample for one state and gathers, for each sampled item, the
 * facts its proof chain needs: the ledger row, a non-persisting bank reconciliation (runReconciliation persist:false),
 * the engine's due-diligence applicability (computeItemTimeline), sent notices and owner replies (dated on the demo
 * calendar via demoDayAt), the filed NAUPA files matched back to items (matchFiledItems), the replica confirmation and
 * the remittance with its approval. Nothing here writes to the database or sends anything.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, companies, ledgerItems, outreach, outreachItems, payees, reports, staleItems, type PropertyType, type StaleItem } from "@/db/schema";
import { buildProofChain, type FiledLine, type ItemFacts, type LinkSource, type ProofLink, type ReconStanding, type SentNotice } from "@/lib/audit/proof-chain";
import { auditSeed, drawSample, type AuditState } from "@/lib/audit/sample";
import { readiness, type Readiness } from "@/lib/audit/score";
import { approverName } from "@/lib/auth/approver";
import { now as clockNow } from "@/lib/clock";
import { demoDayAt, loadClockHistory, type ClockStep } from "@/lib/clock-history";
import type { IsoDate } from "@/lib/dates";
import { runReconciliation } from "@/lib/ingest/persist";
import { computeItemTimeline } from "@/lib/pipeline/compute";
import { readReportFile } from "@/lib/reports/service";
import { matchFiledItems, type FiledCandidate } from "@/lib/reports/report-items";
import { pinRules, tryLoadRules } from "@/lib/rules/load";
import type { RuleFile } from "../../../rules/schema";

export interface AuditItem {
  id: string;
  payeeName: string;
  amountCents: number;
  propertyType: PropertyType;
  status: StaleItem["status"];
  referenceNumber: string | null;
  chain: ProofLink[];
  score: Readiness;
}

export interface AuditDrill {
  state: AuditState;
  today: string;
  size: number;
  all: boolean;
  seed: string;
  populationCount: number;
  ruleVersion: string | null;
  ruleUnverified: boolean;
  items: AuditItem[];
  score: Readiness;
}

export interface AuditQuery {
  state: AuditState;
  size: number;
  all?: boolean;
}

const SENT_LIKE = new Set(["sent", "delivered", "responded"]);
const FILED_REPORT = ["submitted", "confirmed"] as const;
const MAX_SOURCES = 3;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Up to three distinct sources behind the item's dates: dormancy, due diligence, first report stage. */
function ruleSources(file: RuleFile | null, propertyType: PropertyType): LinkSource[] {
  if (!file) return [];
  const all = [
    ...(file.propertyTypes[propertyType]?.dormancyYears.sources ?? []),
    ...file.dueDiligence.required.sources,
    ...(file.reportStages[0]?.dueRule.sources ?? []),
  ];
  const seen = new Set<string>();
  const out: LinkSource[] = [];
  for (const s of all) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    out.push({ title: s.title || s.url, url: s.url });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

/** Ledger id -> its standing in a reconciliation that is computed but never saved. */
async function reconStandings(db: Db, companyId: string, today: string): Promise<Map<string, { standing: ReconStanding; reason?: string }>> {
  const { result } = await runReconciliation(db, companyId, today, { persist: false });
  const out = new Map<string, { standing: ReconStanding; reason?: string }>();
  for (const o of result.outstanding) out.set(o.id, { standing: "outstanding" });
  for (const v of result.voided) out.set(v.id, { standing: "voided" });
  for (const m of result.matched) out.set(m.ledgerId, { standing: "matched", reason: `A bank clear matches this entry (${m.method.replace(/_/g, " ")}), so it may not be owed to the state.` });
  for (const a of result.ambiguous) {
    out.set(a.ledgerId, { standing: "ambiguous", reason: `${a.candidates.length} bank clears could match (${a.reason.replace(/_/g, " ")}); a person has to decide.` });
  }
  return out;
}

/** Notices that actually went out for each item (lead item or listed on a consolidated letter), on the demo calendar. */
async function sentNotices(db: Db, ids: readonly string[], history: readonly ClockStep[], today: string): Promise<Map<string, SentNotice[]>> {
  const out = new Map<string, SentNotice[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return out;
  const listed = await db.select({ outreachId: outreachItems.outreachId, staleItemId: outreachItems.staleItemId }).from(outreachItems).where(inArray(outreachItems.staleItemId, [...ids]));
  const leads = await db.select().from(outreach).where(inArray(outreach.staleItemId, [...ids]));
  const extraIds = [...new Set(listed.map((l) => l.outreachId))].filter((id) => !leads.some((r) => r.id === id));
  const extra = extraIds.length ? await db.select().from(outreach).where(inArray(outreach.id, extraIds)) : [];
  const rows = new Map([...leads, ...extra].map((r) => [r.id, r]));
  const covers = new Map<string, Set<string>>();
  for (const r of leads) covers.set(r.id, new Set([r.staleItemId]));
  for (const l of listed) (covers.get(l.outreachId) ?? covers.set(l.outreachId, new Set()).get(l.outreachId)!).add(l.staleItemId);
  for (const [outreachId, items] of covers) {
    const r = rows.get(outreachId);
    if (!r || !SENT_LIKE.has(r.status) || (r.channel !== "letter" && r.channel !== "email")) continue;
    const notice: SentNotice = { channel: r.channel, status: r.status, sentOn: demoDayAt(r.sentAt?.toISOString(), history, today), outreachId };
    for (const id of items) out.get(id)?.push(notice);
  }
  return out;
}

/** The report version pinned by most of the pool's items, else the current file (mirrors the report service). */
function rulesForPool(state: string, versions: readonly (string | null)[]): RuleFile | null {
  const counts = new Map<string, number>();
  for (const v of versions) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  if (top) {
    try {
      return pinRules(state, top).file;
    } catch {
      /* pinned version missing on disk: current file below */
    }
  }
  return tryLoadRules(state)?.file ?? null;
}

/** Item id -> the filed report whose stored NAUPA file lists it. Reports whose file cannot be read or matched are skipped. */
async function filedLines(db: Db, companyId: string, state: string, history: readonly ClockStep[], today: string): Promise<Map<string, FiledLine>> {
  const out = new Map<string, FiledLine>();
  const filed = await db
    .select()
    .from(reports)
    .where(and(eq(reports.companyId, companyId), eq(reports.state, state), inArray(reports.status, [...FILED_REPORT])));
  if (filed.length === 0) return out;
  const pool = await db
    .select({ stale: staleItems, ledgerRef: ledgerItems.referenceNumber, ledgerLast: ledgerItems.lastActivityDate, issueDate: ledgerItems.issueDate })
    .from(staleItems)
    .leftJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
    .where(and(eq(staleItems.companyId, companyId), eq(staleItems.ownerState, state), inArray(staleItems.status, ["to_report", "reported", "remitted"])));
  const candidates: FiledCandidate[] = pool.map((p) => ({
    id: p.stale.id,
    referenceNumber: p.ledgerRef ?? null,
    amountCents: p.stale.amountCents,
    propertyType: p.stale.propertyType,
    lastActivityDate: p.stale.lastActivityDate ?? p.ledgerLast ?? p.issueDate ?? p.stale.staleSince,
  }));
  const rules = rulesForPool(state, pool.map((p) => p.stale.ruleVersion));
  if (!rules) return out;
  for (const report of filed) {
    if (!report.filePath) continue;
    let text: string;
    try {
      ({ text } = await readReportFile(db, report.id));
    } catch {
      continue;
    }
    const match = matchFiledItems(text, candidates, rules);
    if (!match.ok) continue;
    const line: FiledLine = {
      reportId: report.id,
      stage: report.stage,
      checksum: report.checksum,
      confirmation: report.replicaConfirmation,
      submittedOn: demoDayAt(report.submittedAt?.toISOString(), history, today),
    };
    for (const id of match.ids) if (!out.has(id)) out.set(id, line);
  }
  return out;
}

interface RemittanceRecordJson {
  remittedOn?: unknown;
  reference?: unknown;
  by?: unknown;
  approvalId?: unknown;
}

async function remittanceApprovals(db: Db, items: readonly StaleItem[]): Promise<Map<string, Date | null>> {
  const ids = items
    .map((i) => (isObj(i.classification) && isObj(i.classification.remittance) ? (i.classification.remittance as RemittanceRecordJson).approvalId : null))
    .filter((v): v is string => typeof v === "string");
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: approvals.id, approvedAt: approvals.approvedAt }).from(approvals).where(inArray(approvals.id, ids));
  return new Map(rows.map((r) => [r.id, r.approvedAt]));
}

function ownerResponseOf(item: StaleItem, history: readonly ClockStep[], today: string): ItemFacts["ownerResponse"] {
  const r = isObj(item.classification) ? item.classification.ownerResponse : null;
  if (!isObj(r) || typeof r.intent !== "string") return null;
  return { intent: r.intent, on: demoDayAt(typeof r.at === "string" ? r.at : null, history, today) };
}

/** Read-only: the deterministic sample for one state and every sampled item's proof chain. */
export async function loadAuditDrill(db: Db, companyId: string, q: AuditQuery): Promise<AuditDrill> {
  const state = q.state;
  const all = Boolean(q.all);
  const [today, history, [company]] = await Promise.all([
    clockNow(db, companyId),
    loadClockHistory(db, companyId),
    db.select({ fiscalYearEnd: companies.fiscalYearEnd }).from(companies).where(eq(companies.id, companyId)),
  ]);
  const population = await db
    .select({ id: staleItems.id })
    .from(staleItems)
    .where(and(eq(staleItems.companyId, companyId), eq(staleItems.ownerState, state)));
  const seed = auditSeed(state, today, q.size);
  const ids = drawSample(population.map((p) => p.id), seed, q.size, all);
  const loaded = tryLoadRules(state);
  const base = { state, today, size: q.size, all, seed, populationCount: population.length, ruleVersion: loaded?.file.version ?? null };

  if (ids.length === 0) return { ...base, ruleUnverified: false, items: [], score: readiness([]) };

  const rows = await db
    .select({ stale: staleItems, ledger: ledgerItems, payeeName: payees.canonicalName })
    .from(staleItems)
    .leftJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
    .leftJoin(payees, eq(payees.id, staleItems.ownerPayeeId))
    .where(inArray(staleItems.id, ids));
  const byId = new Map(rows.map((r) => [r.stale.id, r]));

  const [recon, notices, filed, approvedAt] = await Promise.all([
    reconStandings(db, companyId, today),
    sentNotices(db, ids, history, today),
    filedLines(db, companyId, state, history, today),
    remittanceApprovals(db, rows.map((r) => r.stale)),
  ]);

  const items: AuditItem[] = ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    const { stale, ledger } = row;
    const lastActivity = (stale.lastActivityDate ?? ledger?.lastActivityDate ?? ledger?.issueDate ?? stale.staleSince) as IsoDate;
    // Whether due diligence applies is the rules engine's call (never re-derived here).
    const timeline = computeItemTimeline({
      ownerState: stale.ownerState,
      propertyType: stale.propertyType,
      lastActivityDate: lastActivity,
      amountCents: stale.amountCents,
      holderFiscalYearEnd: company?.fiscalYearEnd ?? "12-31",
    });
    const rem = isObj(stale.classification) && isObj(stale.classification.remittance) ? (stale.classification.remittance as RemittanceRecordJson) : null;
    const approvalId = typeof rem?.approvalId === "string" ? rem.approvalId : null;
    const facts: ItemFacts = {
      staleItemId: stale.id,
      status: stale.status,
      amountCents: stale.amountCents,
      ownerState: stale.ownerState,
      ownerStateBasis: stale.ownerStateBasis,
      ledger: ledger
        ? { referenceNumber: ledger.referenceNumber, issueDate: ledger.issueDate, amountCents: ledger.amountCents, source: ledger.source, status: ledger.status }
        : null,
      recon: ledger ? (recon.get(ledger.id) ?? { standing: "absent" }) : { standing: "absent" },
      rule: { version: stale.ruleVersion, dependsOnUnverified: stale.dependsOnUnverified, sources: ruleSources(loaded?.file ?? null, stale.propertyType) },
      ddApplies: timeline.ddApplies,
      ddWindowStart: stale.ddWindowStart,
      ddWindowEnd: stale.ddWindowEnd,
      notices: notices.get(stale.id) ?? [],
      ownerResponse: ownerResponseOf(stale, history, today),
      reportDue: stale.reportDueDate,
      remitDue: stale.remitDueDate,
      filed: filed.get(stale.id) ?? null,
      remittance:
        rem && typeof rem.remittedOn === "string"
          ? {
              remittedOn: rem.remittedOn,
              reference: typeof rem.reference === "string" ? rem.reference : null,
              by: approverName(typeof rem.by === "string" ? rem.by : null) ?? "unknown",
              approvalId,
              approvedOn: approvalId ? demoDayAt(approvedAt.get(approvalId)?.toISOString(), history, today) : null,
            }
          : null,
    };
    const chain = buildProofChain(facts, today);
    return [
      {
        id: stale.id,
        payeeName: row.payeeName ?? ledger?.payeeNameRaw ?? "Unknown payee",
        amountCents: stale.amountCents,
        propertyType: stale.propertyType,
        status: stale.status,
        referenceNumber: ledger?.referenceNumber ?? null,
        chain,
        score: readiness([chain]),
      },
    ];
  });

  return {
    ...base,
    ruleUnverified: items.some((i) => i.chain.some((l) => l.unverified)),
    items,
    score: readiness(items.map((i) => i.chain)),
  };
}
