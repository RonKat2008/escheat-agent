import { companies, ledgerItems, payees, staleItems, type Company, type LedgerItem, type StaleItem } from "@/db/schema";
import type { Db } from "@/db/client";
import { parseEnv, type Env } from "@/lib/env";

/** Test-only helpers for the outreach lane (SYNTHETIC data). */

export const TEST_SECRET = "owner-link-secret-0123456789abcdef";

export function testEnv(extra: Record<string, string> = {}): Env {
  return parseEnv({
    OWNER_LINK_SECRET: TEST_SECRET,
    APP_BASE_URL: "https://escheat.test",
    ALLOWED_TEST_RECIPIENTS: "owner@example.com",
    ALLOWED_TEST_PHONES: "+14155550100",
    AGENTMAIL_INBOX_ID: "escheat-agent@agentmail.test",
    ...extra,
  });
}

export interface Seeded {
  company: Company;
  ledger: LedgerItem;
  stale: StaleItem;
}

export async function seedItem(
  db: Db,
  opts: { ownerState?: string | null; withAddress?: boolean; amountCents?: number; status?: StaleItem["status"]; ref?: string } = {},
): Promise<Seeded> {
  const ownerState = opts.ownerState === undefined ? "CA" : opts.ownerState;
  const withAddress = opts.withAddress ?? true;
  const [company] = await db
    .insert(companies)
    .values({
      name: "Northwind Fixtures, Inc. (SYNTHETIC)",
      incorporationState: "DE",
      hqState: "TX",
      addressLine: "100 Congress Ave",
      city: "Austin",
      zip: "78701",
    })
    .returning();
  const [payee] = await db
    .insert(payees)
    .values({
      companyId: company!.id,
      canonicalName: "Bayline Electric",
      addressLine: withAddress ? "500 Market St" : null,
      city: withAddress ? "San Francisco" : null,
      state: withAddress ? (ownerState ?? "CA") : null,
      zip: withAddress ? "94105" : null,
    })
    .returning();
  const [ledger] = await db
    .insert(ledgerItems)
    .values({
      companyId: company!.id,
      payeeId: payee!.id,
      payeeNameRaw: "Bayline Electric",
      propertyType: "vendor_check",
      referenceNumber: opts.ref ?? "10482",
      amountCents: opts.amountCents ?? 234000,
      issueDate: "2025-08-01",
    })
    .returning();
  const [stale] = await db
    .insert(staleItems)
    .values({
      companyId: company!.id,
      ledgerItemId: ledger!.id,
      ownerPayeeId: payee!.id,
      amountCents: opts.amountCents ?? 234000,
      propertyType: "vendor_check",
      ownerState,
      status: opts.status ?? "dd_pending",
      staleSince: "2026-02-01",
    })
    .returning();
  return { company: company!, ledger: ledger!, stale: stale! };
}
