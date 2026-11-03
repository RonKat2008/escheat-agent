/**
 * Membership of the Items saved views that the Loop Bar links to (/items?view=needs-action, /items?view=draft-ready).
 * The predicates mirror src/components/shell/loop-data.ts (Triage and Draft) exactly, so the view's row count equals the
 * Loop Bar count. Server-only: returns the ids; the list itself still comes from listStaleItems.
 */
import { and, eq, gte, inArray, isNotNull, lte, notExists, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach, staleItems } from "@/db/schema";
import type { IsoDate } from "@/lib/dates";
import { CLOSED_STATUSES } from "@/lib/queries/common";

const DONE_STATUSES = [...CLOSED_STATUSES, "reported"] as const;
const LIVE_OUTREACH = ["draft", "awaiting_approval", "approved", "sent", "delivered", "responded"] as const;

export interface ViewMembership {
  needsAction: ReadonlySet<string>;
  draftReady: ReadonlySet<string>;
}

export async function getViewMembership(db: Db, companyId: string, asOf: IsoDate): Promise<ViewMembership> {
  const open = notInArray(staleItems.status, [...DONE_STATUSES]);
  const ofCompany = eq(staleItems.companyId, companyId);
  const [triage, draft] = await Promise.all([
    db
      .select({ id: staleItems.id })
      .from(staleItems)
      .where(and(ofCompany, open, or(inArray(staleItems.status, ["dd_pending", "needs_rule"]), eq(staleItems.needsReview, true)))),
    db
      .select({ id: staleItems.id })
      .from(staleItems)
      .where(
        and(
          ofCompany,
          open,
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
      ),
  ]);
  return { needsAction: new Set(triage.map((r) => r.id)), draftReady: new Set(draft.map((r) => r.id)) };
}
