import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companies, ledgerItems, outreach, staleItems } from "@/db/schema";
import { now as clockNow } from "@/lib/clock";
import { PROPERTY_LABEL } from "@/lib/letters/context";
import { sentDateOf } from "@/lib/outreach/util";

export interface OwnerView {
  holderName: string;
  amountCents: number;
  referenceNumber: string | null;
  issueDate: string;
  itemLabel: string;
  payeeName: string;
  /** The holder's "today" (demo clock aware), for the owner rail. */
  asOf: string;
  /** Day this notice went out, if it has (else the day it was prepared). */
  contactedOn: string | null;
  /** State the money goes to if nobody responds; null when unknown (never guessed). */
  ownerState: string | null;
  /** Last day to respond before the item is reported to the state (end of the due-diligence window), if known. */
  respondBy: string | null;
  /** The respond-by date depends on a rule value a person has not checked yet. */
  respondByUnverified: boolean;
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
    asOf: await clockNow(db, stale.companyId),
    contactedOn: sentDateOf(o) ?? o.createdAt.toISOString().slice(0, 10),
    ownerState: stale.ownerState,
    respondBy: stale.ddWindowEnd ?? null,
    respondByUnverified: stale.dependsOnUnverified,
  };
}
