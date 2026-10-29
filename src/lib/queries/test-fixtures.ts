/** Test-only fixture builder (hand-inserted rows). SYNTHETIC. */
import type { Db } from "@/db/client";
import { companies, ledgerItems, payees, staleItems, type NewStaleItem } from "@/db/schema";

export interface FixtureItem {
  key: string;
  check: string;
  payee: string;
  cents: number;
  issueDate: string;
  state: string | null;
  status: NewStaleItem["status"];
  propertyType?: NewStaleItem["propertyType"];
  unverified?: boolean;
  ddStart?: string | null;
  ddEnd?: string | null;
  report?: string | null;
  remit?: string | null;
  presumed?: string | null;
  ruleVersion?: string | null;
  classification?: Record<string, unknown>;
}

export async function insertFixture(db: Db, items: FixtureItem[]) {
  const [co] = await db
    .insert(companies)
    .values({ name: "Test Holder, Inc. (SYNTHETIC)", incorporationState: "DE", hqState: "TX" })
    .returning();
  const ids: Record<string, { staleId: string; ledgerId: string; payeeId: string }> = {};
  for (const it of items) {
    const [p] = await db
      .insert(payees)
      .values({ companyId: co!.id, canonicalName: it.payee, state: it.state, city: "Testville", addressLine: "1 Test St", zip: "00000" })
      .returning();
    const [li] = await db
      .insert(ledgerItems)
      .values({
        companyId: co!.id,
        payeeId: p!.id,
        payeeNameRaw: it.payee.toUpperCase(),
        propertyType: it.propertyType ?? "vendor_check",
        referenceNumber: it.check,
        amountCents: it.cents,
        issueDate: it.issueDate,
        status: "outstanding",
        source: "synthetic",
      })
      .returning();
    const [si] = await db
      .insert(staleItems)
      .values({
        companyId: co!.id,
        ledgerItemId: li!.id,
        ownerPayeeId: p!.id,
        amountCents: it.cents,
        propertyType: it.propertyType ?? "vendor_check",
        ownerState: it.state,
        ownerStateBasis: it.state ? "address" : null,
        status: it.status,
        staleSince: it.issueDate,
        presumedAbandonedDate: it.presumed ?? null,
        ddWindowStart: it.ddStart ?? null,
        ddWindowEnd: it.ddEnd ?? null,
        reportDueDate: it.report ?? null,
        remitDueDate: it.remit ?? null,
        ruleVersion: it.ruleVersion ?? null,
        dependsOnUnverified: it.unverified ?? false,
        classification: it.classification ?? null,
      })
      .returning();
    ids[it.key] = { staleId: si!.id, ledgerId: li!.id, payeeId: p!.id };
  }
  return { companyId: co!.id, ids };
}

export const STANDARD_ITEMS: FixtureItem[] = [
  { key: "a", check: "10482", payee: "Bayline Electric", cents: 234000, issueDate: "2025-09-01", state: "CA", status: "watching", ddStart: "2026-11-01", ddEnd: "2026-12-01", report: "2027-06-30", remit: "2027-10-31" },
  { key: "b", check: "20001", payee: "Lone Star Supply", cents: 50000, issueDate: "2025-01-15", state: "TX", status: "dd_pending", unverified: true, ddStart: "2026-10-31", ddEnd: "2026-12-02", report: "2027-07-01" },
  { key: "c", check: "30001", payee: "First State Freight", cents: 25050, issueDate: "2024-12-01", state: "DE", status: "dd_sent", propertyType: "customer_credit", ddEnd: "2026-11-15" },
  { key: "d", check: "40001", payee: "Paid Already LLC", cents: 99999, issueDate: "2024-01-01", state: "CA", status: "resolved_paid", ddStart: "2026-11-05" },
  { key: "e", check: "50001", payee: "Remitted Co", cents: 77777, issueDate: "2023-01-01", state: "TX", status: "remitted", remit: "2026-11-05" },
  { key: "f", check: "60001", payee: "Mystery Payee", cents: 1000, issueDate: "2025-02-02", state: null, status: "needs_rule", classification: { needs_review: true } },
];
