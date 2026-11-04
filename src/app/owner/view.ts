import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companies, ledgerItems, outreach, staleItems } from "@/db/schema";
import { now as clockNow } from "@/lib/clock";
import { formatDate } from "@/lib/format";
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

export interface OwnerRailStep {
  key: "issued" | "contacted" | "respond_by";
  label: string;
  /** Always a real date: a step without one is left out, never shown as "Unknown". */
  date: string;
}

export interface OwnerRailView {
  /** Day the notice went out, never after the holder's "today" (a real-clock send date can't follow the demo date). */
  wroteOn: string | null;
  respondLabel: string;
  /** The dated steps the owner sees, in order. Only steps with a known date (R5-13). */
  steps: OwnerRailStep[];
  help: string;
}

/**
 * Plain-language copy for the owner rail (R4-13, R5-13). The owner never sees "UNVERIFIED", "Unknown", rule versions,
 * verification columns or internal codes. A respond-by date that depends on an unchecked rule value is labelled
 * "(estimated)"; with no respond-by date the line is dropped and the help simply asks them to answer.
 */
export function ownerRailView(
  v: Pick<OwnerView, "contactedOn" | "asOf" | "respondBy" | "respondByUnverified" | "ownerState"> & Partial<Pick<OwnerView, "issueDate">>,
): OwnerRailView {
  const wroteOn = v.contactedOn && v.contactedOn > v.asOf ? v.asOf : v.contactedOn;
  const est = v.respondBy && v.respondByUnverified ? " (estimated)" : "";
  const respondLabel = `Respond by${est}`;
  const to = v.ownerState ? `the state of ${v.ownerState}` : "the state";
  const help = v.respondBy
    ? `If we don't hear from you by ${formatDate(v.respondBy)}${est}, this money is due to be reported to ${to}.`
    : "Please answer below as soon as you can, so we can get this money to you.";
  const steps: OwnerRailStep[] = [];
  if (v.issueDate) steps.push({ key: "issued", label: "Payment issued", date: v.issueDate });
  if (wroteOn) steps.push({ key: "contacted", label: "We wrote to you", date: wroteOn });
  if (v.respondBy) steps.push({ key: "respond_by", label: respondLabel, date: v.respondBy });
  return { wroteOn, respondLabel, steps, help };
}
