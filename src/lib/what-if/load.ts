/**
 * Thin, read-only loader for the what-if simulator: SELECTs only. It reads the demo clock (never advances it, never
 * touches sim_clock), the open stale items with their persisted rules-engine dates, and each state's sourced interest
 * rule from rules/*.json. Everything after this is pure (project.ts, interest.ts).
 */
import { and, asc, eq, notInArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { ledgerItems, payees, staleItems } from "@/db/schema";
import { now } from "@/lib/clock";
import { tryLoadRules } from "@/lib/rules/load";
import { CLOSED_STATUSES } from "@/lib/queries/common";
import { UNKNOWN_STATE, type InterestRules, type WhatIfItem, type WhatIfSnapshot } from "./types";

export async function loadWhatIfSnapshot(db: Db, companyId: string): Promise<WhatIfSnapshot> {
  const today = await now(db, companyId);
  const rows = await db
    .select({
      id: staleItems.id,
      payeeName: payees.canonicalName,
      payeeNameRaw: ledgerItems.payeeNameRaw,
      checkNumber: ledgerItems.referenceNumber,
      amountCents: staleItems.amountCents,
      ownerState: staleItems.ownerState,
      status: staleItems.status,
      presumedAbandonedDate: staleItems.presumedAbandonedDate,
      ddWindowStart: staleItems.ddWindowStart,
      ddWindowEnd: staleItems.ddWindowEnd,
      reportDueDate: staleItems.reportDueDate,
      remitDueDate: staleItems.remitDueDate,
      reportStage: staleItems.reportStage,
      unverified: staleItems.dependsOnUnverified,
    })
    .from(staleItems)
    .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
    .leftJoin(payees, eq(payees.id, staleItems.ownerPayeeId))
    .where(and(eq(staleItems.companyId, companyId), notInArray(staleItems.status, [...CLOSED_STATUSES])))
    .orderBy(asc(staleItems.ownerState), asc(staleItems.reportDueDate), asc(ledgerItems.referenceNumber), asc(staleItems.id));

  const items: WhatIfItem[] = rows.map(({ payeeNameRaw, payeeName, ...r }) => ({ ...r, payeeName: payeeName ?? payeeNameRaw }));
  const rules: Record<string, InterestRules | null> = {};
  for (const state of new Set(items.map((i) => i.ownerState ?? UNKNOWN_STATE))) {
    if (state === UNKNOWN_STATE) {
      rules[state] = null;
      continue;
    }
    const loaded = tryLoadRules(state);
    rules[state] = loaded ? { state: loaded.file.state, version: loaded.file.version, interest: loaded.file.interest } : null;
  }
  return { today, items, rules };
}
