import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companies, ledgerItems, outreach, staleItems } from "@/db/schema";
import { PROPERTY_LABEL } from "@/lib/letters/context";

export interface OwnerView {
  holderName: string;
  amountCents: number;
  referenceNumber: string | null;
  issueDate: string;
  itemLabel: string;
  payeeName: string;
}

/** What the owner sees. Only called after the token has been verified. */
export async function loadOwnerView(db: Db, outreachId: string): Promise<OwnerView | null> {
  const [o] = await db.select().from(outreach).where(eq(outreach.id, outreachId));
  if (!o) return null;
  const [stale] = await db.select().from(staleItems).where(eq(staleItems.id, o.staleItemId));
  if (!stale) return null;
  const [ledger] = await db.select().from(ledgerItems).where(eq(ledgerItems.id, stale.ledgerItemId));
  const [company] = await db.select().from(companies).where(eq(companies.id, stale.companyId));
  if (!ledger || !company) return null;
  return {
    holderName: company.name,
    amountCents: stale.amountCents,
    referenceNumber: ledger.referenceNumber,
    issueDate: ledger.issueDate,
    itemLabel: PROPERTY_LABEL[ledger.propertyType] ?? "payment",
    payeeName: ledger.payeeNameRaw,
  };
}
