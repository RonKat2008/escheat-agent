import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { ledgerItems, outreach, payees, staleItems } from "@/db/schema";
import { DISCLAIMER } from "@/lib/disclaimer";
import { formatUSD } from "@/lib/money";
import { CLOSED_STATUSES, findStaleItemId, formatAddress } from "@/lib/queries";

export const DRAFT_ONLY_NOTICE = "Draft only — a human must approve in the app at /approvals";

export interface DraftSummary {
  outreachId: string;
  staleItemId: string;
  channel: "letter";
  status: string;
  created: boolean;
  toAddress: string | null;
  subject: string | null;
  bodyPreview: string | null;
  notice: string;
}

/**
 * Creates (or returns the existing) due-diligence LETTER draft for a stale item. Writes one outreach row with
 * status "draft". It never sends anything and never creates an approval: approval happens in the app.
 */
export async function createOutreachDraft(db: Db, companyId: string, itemRef: string): Promise<DraftSummary> {
  const id = await findStaleItemId(db, companyId, itemRef);
  if (!id) throw new Error(`No stale item matches "${itemRef}"`);
  const [si] = await db.select().from(staleItems).where(eq(staleItems.id, id));
  if (!si) throw new Error(`No stale item matches "${itemRef}"`);
  if ((CLOSED_STATUSES as readonly string[]).includes(si.status)) {
    throw new Error(`Item is ${si.status}; no outreach is needed`);
  }

  const summarize = (o: typeof outreach.$inferSelect, created: boolean): DraftSummary => ({
    outreachId: o.id,
    staleItemId: id,
    channel: "letter",
    status: o.status,
    created,
    toAddress: o.toAddress,
    subject: o.subject,
    bodyPreview: o.body ? o.body.slice(0, 400) : null,
    notice: DRAFT_ONLY_NOTICE,
  });

  const findExisting = async () => {
    const [row] = await db
      .select()
      .from(outreach)
      .where(and(eq(outreach.staleItemId, id), eq(outreach.channel, "letter"), inArray(outreach.status, ["draft", "awaiting_approval"])))
      .orderBy(asc(outreach.createdAt))
      .limit(1);
    return row;
  };
  const existing = await findExisting();
  if (existing) return summarize(existing, false);

  const [li] = await db.select().from(ledgerItems).where(eq(ledgerItems.id, si.ledgerItemId));
  const [payee] = si.ownerPayeeId ? await db.select().from(payees).where(eq(payees.id, si.ownerPayeeId)) : [];
  const name = payee?.canonicalName ?? li?.payeeNameRaw ?? "Payee";
  const address = formatAddress(payee ?? li ?? {}) || null;
  const check = li?.referenceNumber ? `check #${li.referenceNumber}` : "an unclaimed payment";
  const subject = `Important notice about ${check} (${formatUSD(si.amountCents)})`;
  const body = [
    `DRAFT — not sent. ${DISCLAIMER}`,
    ``,
    `To: ${name}`,
    ``,
    `Our records show ${check} for ${formatUSD(si.amountCents)} issued ${li?.issueDate ?? si.staleSince} has not been cashed.`,
    `Please confirm your current mailing address or contact us so we can resolve this payment.`,
    `If we cannot reach you, the funds may have to be reported to the state as unclaimed property.`,
    ``,
    `(Placeholder text generated via MCP. The final letter wording is produced and reviewed in the app before approval.)`,
  ].join("\n");

  const [created] = await db
    .insert(outreach)
    .values({ companyId: si.companyId, staleItemId: id, channel: "letter", status: "draft", toAddress: address, subject, body, offline: false })
    .returning();
  return summarize(created!, true);
}
