/**
 * Stale-item detection: reconcile -> filter business-stale -> classify -> deterministic timeline -> upsert.
 * "Stale" (STALE_THRESHOLD_DAYS, a business setting) is separate from "presumed abandoned" (law, from rules).
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companies, staleItems, type LedgerItem } from "@/db/schema";
import { classifyBatch, type Classification } from "@/lib/agents/classifier";
import type { ClassifierItem } from "@/lib/agents/types";
import * as clock from "@/lib/clock";
import { addDays, type IsoDate } from "@/lib/dates";
import { staleThresholdDays } from "@/lib/env";
import { runReconciliation } from "@/lib/ingest/persist";
import { isStale } from "@/lib/recon/reconcile";
import {
  applyActions,
  computeItemTimeline,
  decideStatus,
  deadlinesMoved,
  naupaCodeFor,
  type ComputedTimeline,
} from "./compute";

export interface DetectOptions {
  asOf?: string;
  thresholdDays?: number;
  /** Test seam; defaults to classifyBatch (heuristic fallback, labeled, when no API key). */
  classify?: typeof classifyBatch;
}

export interface AmbiguousReport {
  ledgerItemId: string;
  reason: string;
  candidates: string[];
}

export interface DetectSummary {
  asOf: string;
  thresholdDays: number;
  inserted: number;
  updated: number;
  /** Stale items per owner state among those detected this run. */
  byState: Record<string, number>;
  totalCents: number;
  /** Items below the classifier confidence threshold. */
  needsReview: number;
  /** Items whose owner state has no rule file (or whose deadlines are unknown). */
  needsRule: number;
  /** Outstanding but not business-stale: not inserted. */
  skippedNotStale: number;
  /** Recon-ambiguous ledger items: reported, never inserted. */
  ambiguous: AmbiguousReport[];
  /** ids of newly inserted stale_items (callers may emit item/stale.created). */
  newItemIds: string[];
  /** Classification method counts (worker / orchestrator / heuristic). */
  methods: Record<string, number>;
}

function toClassifierItem(item: LedgerItem): ClassifierItem {
  return {
    kind: item.propertyType === "customer_credit" ? "credit" : item.propertyType === "unapplied_cash" ? "unapplied_cash" : "check",
    number: item.referenceNumber,
    payee_name: item.payeeNameRaw,
    payee_address: item.addressLine,
    payee_city: item.city,
    payee_state: item.state,
    payee_zip: item.zip,
    amount_cents: item.amountCents,
    issue_date: item.issueDate,
    memo: item.memo,
    cleared_date: null,
  };
}

/** Rationale/method/conflicts/timeline stages only; scalar fields live in real columns. */
function classificationJson(c: Classification, tl: ComputedTimeline): Record<string, unknown> {
  const { property_code: _modelCode, confidence: _confidence, needs_review: _needsReview, ...rest } = c;
  void _modelCode;
  void _confidence;
  void _needsReview;
  return { ...rest, timeline: tl.summary };
}

export async function detectStaleItems(db: Db, companyId: string, opts: DetectOptions = {}): Promise<DetectSummary> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) throw new Error(`Unknown company ${companyId}`);
  const asOf = (opts.asOf ?? (await clock.now(db, companyId))) as IsoDate;
  const thresholdDays = opts.thresholdDays ?? staleThresholdDays();

  const recon = await runReconciliation(db, companyId, asOf);
  const stale = recon.outstanding.filter((o) => isStale(o, asOf, thresholdDays));
  const ambiguous: AmbiguousReport[] = recon.result.ambiguous.map((a) => ({
    ledgerItemId: a.ledgerId,
    reason: a.reason,
    candidates: a.candidates,
  }));

  const classify = opts.classify ?? classifyBatch;
  const classifications = await classify(stale.map(toClassifierItem), {
    ctx: {
      holder: { name: company.name, stateOfIncorporation: company.incorporationState },
      db,
      companyId,
      propertyCodeFor: naupaCodeFor,
    },
  });

  const existingRows = await db.select().from(staleItems).where(eq(staleItems.companyId, companyId));
  const existingByLedger = new Map(existingRows.map((r) => [r.ledgerItemId, r]));

  const summary: DetectSummary = {
    asOf,
    thresholdDays,
    inserted: 0,
    updated: 0,
    byState: {},
    totalCents: 0,
    needsReview: 0,
    needsRule: 0,
    skippedNotStale: recon.outstanding.length - stale.length,
    ambiguous,
    newItemIds: [],
    methods: {},
  };

  for (let i = 0; i < stale.length; i++) {
    const item = stale[i]!;
    const c = classifications[i]!;
    const prev = existingByLedger.get(item.id);
    const lastActivity = (item.lastActivityDate ?? item.issueDate) as IsoDate;
    const tl = computeItemTimeline({
      ownerState: c.owner_state,
      propertyType: c.property_type,
      lastActivityDate: lastActivity,
      amountCents: item.amountCents,
      holderFiscalYearEnd: company.fiscalYearEnd,
    });
    // Human-driven statuses are preserved: the machine only moves forward from the persisted status.
    const decision = decideStatus({ status: prev?.status ?? "watching", ...tl.dates }, tl.ddApplies, asOf);

    const values = {
      ownerPayeeId: item.payeeId,
      amountCents: item.amountCents,
      propertyType: c.property_type,
      ownerState: c.owner_state,
      ownerStateBasis: c.owner_state_basis,
      status: decision.status,
      ...tl.dates,
      propertyCode: tl.propertyCode,
      lastActivityDate: lastActivity,
      classificationConfidence: Math.round(c.confidence * 100),
      needsReview: c.needs_review,
      classification: classificationJson(c, tl),
    };
    const moved = prev ? deadlinesMoved(prev, tl.dates) : false;
    // Single atomic upsert on the unique ledger_item_id; stale_since is set only on first insert.
    const [row] = await db
      .insert(staleItems)
      .values({ companyId, ledgerItemId: item.id, staleSince: addDays(item.issueDate as IsoDate, thresholdDays + 1), ...values })
      .onConflictDoUpdate({
        target: staleItems.ledgerItemId,
        set: { ...values, ...(moved ? { deadlineMovedAt: new Date() } : {}) },
      })
      .returning({ id: staleItems.id });
    const rowId = row!.id;
    if (prev) summary.updated++;
    else {
      summary.inserted++;
      summary.newItemIds.push(rowId);
    }
    await applyActions(db, { id: rowId, companyId }, decision.actions);

    summary.byState[c.owner_state] = (summary.byState[c.owner_state] ?? 0) + 1;
    summary.totalCents += item.amountCents;
    if (c.needs_review) summary.needsReview++;
    if (decision.status === "needs_rule") summary.needsRule++;
    summary.methods[c.method] = (summary.methods[c.method] ?? 0) + 1;
  }
  return summary;
}
