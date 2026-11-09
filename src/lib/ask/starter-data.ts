/**
 * Server-side input for the Ask starter chips (docs/ASK-MODE.md §1.4, slice 1). Every number is a count over real rows:
 * the approvals and Draft counts come from the Loop Bar's own reads (loadLoopData), the draftable check from the same
 * "open window, no live outreach" condition, and the close-out states from the live To Report pool.
 */
import { and, asc, count, desc, eq, gte, inArray, isNotNull, lte, notExists, notInArray, or, sql } from "drizzle-orm";
import { ledgerItems, outreach, staleItems } from "@/db/schema";
import { CLOSED_STATUSES } from "@/lib/queries/common";
import { loadLoopData } from "@/components/shell/loop-data";
import { getCtx } from "@/lib/ui/ctx";
import { getOverdue } from "@/lib/queries/overdue";
import { loadApprovalsWaiting } from "./cards/approval-data";
import { gettingStartedSteps, integrationRows, loadOnboardingCounts } from "./cards/data";
import type { StarterState } from "./starters";

/** Outreach that counts as "a draft exists" (mirrors LIVE_OUTREACH in components/shell/loop-data.ts). */
const LIVE_OUTREACH = ["draft", "awaiting_approval", "approved", "sent", "delivered", "responded"] as const;

export async function loadStarterState(): Promise<StarterState> {
  const { db, companyId } = await getCtx();
  const loop = await loadLoopData();
  const asOf = loop.asOf;
  const ofCompany = eq(staleItems.companyId, companyId);

  const [firstDraftable, toReport] = await Promise.all([
    db
      .select({ check: ledgerItems.referenceNumber })
      .from(staleItems)
      .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
      .where(
        and(
          ofCompany,
          isNotNull(ledgerItems.referenceNumber),
          notInArray(staleItems.status, [...CLOSED_STATUSES, "reported"]),
          isNotNull(staleItems.ddWindowStart),
          lte(staleItems.ddWindowStart, asOf),
          or(sql`${staleItems.ddWindowEnd} is null`, gte(staleItems.ddWindowEnd, asOf)),
          notExists(
            db
              .select({ one: sql`1` })
              .from(outreach)
              .where(and(eq(outreach.staleItemId, staleItems.id), inArray(outreach.status, [...LIVE_OUTREACH]))),
          ),
        ),
      )
      .orderBy(asc(staleItems.ddWindowEnd), asc(ledgerItems.referenceNumber))
      .limit(1),
    db
      .select({ state: staleItems.ownerState, n: count() })
      .from(staleItems)
      .where(and(ofCompany, eq(staleItems.status, "to_report"), isNotNull(staleItems.ownerState)))
      .groupBy(staleItems.ownerState)
      .orderBy(desc(count()), asc(staleItems.ownerState)),
  ]);

  const [onboarding, overdue, waiting] = await Promise.all([loadOnboardingCounts(db, companyId), getOverdue(db, companyId), loadApprovalsWaiting({ db, companyId })]);
  const steps = gettingStartedSteps(onboarding);
  const integrations = integrationRows(process.env);
  const off = (id: string) => integrations.find((r) => r.id === id)?.state !== "configured";

  return {
    // The review card's own definition (R11-06), so the chip, the card and the draft card agree.
    approvalsWaiting: waiting.total,
    approvalsToCompose: waiting.toCompose,
    draftReady: loop.counts.draft ?? 0,
    draftCheck: firstDraftable[0]?.check ?? null,
    toReport: toReport.flatMap((r) => (r.state ? [{ state: r.state, count: Number(r.n) }] : [])),
    ledgerRows: onboarding.ledgerRows,
    overdue: overdue.count,
    setupDone: steps.filter((s) => s.done).length,
    setupTotal: steps.length,
    integrationsUnconfigured: off("qbo") && off("plaid"),
  };
}
