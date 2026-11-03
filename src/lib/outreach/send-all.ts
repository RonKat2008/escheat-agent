import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach } from "@/db/schema";
import { BULK_MAX } from "./bulk-limits";
import { errorInfo } from "./http";
import { sendOutreach } from "./send";
import type { SendDeps } from "./lob";
import type { EmailDeps } from "./email";
import type { VoiceDeps } from "./voice";

/** Per-item outcome. `offline` = the offline path ran: nothing was mailed, emailed or called. */
export type SendAllItem =
  | { outreachId: string; channel: string; outcome: "sent"; providerId: string | null }
  | { outreachId: string; channel: string; outcome: "offline" }
  | { outreachId: string; channel: string; outcome: "failed"; code: string; error: string };

export interface SendAllResult {
  items: SendAllItem[];
  summary: { sent: number; offline: number; failed: number };
  /** Approved rows beyond BULK_MAX that were left for the next run. */
  remaining: number;
}

/**
 * "Send all approved" (biggest opportunity #5). Each approved outreach of the company goes through the exact single-item
 * executor (sendOutreach), so each one still asserts its own unconsumed approval of the exact payload, the email/phone
 * allowlist and the Lob test-key guard. Nothing unapproved is touched; one failure never stops the others. Offline runs
 * are reported as offline, never as sent.
 */
export async function sendAllApproved(
  db: Db,
  companyId: string,
  opts: { requestedBy?: string } & SendDeps & EmailDeps & VoiceDeps = {},
): Promise<SendAllResult> {
  const rows = await db
    .select({ id: outreach.id, channel: outreach.channel })
    .from(outreach)
    .where(and(eq(outreach.companyId, companyId), eq(outreach.status, "approved")))
    .orderBy(asc(outreach.createdAt));
  const batch = rows.slice(0, BULK_MAX);
  const items: SendAllItem[] = [];
  for (const row of batch) {
    try {
      const r = await sendOutreach(db, row.id, opts);
      items.push(r.offline || !r.sent ? { outreachId: row.id, channel: row.channel, outcome: "offline" } : { outreachId: row.id, channel: row.channel, outcome: "sent", providerId: r.providerId });
    } catch (err) {
      const { error, extra } = errorInfo(err);
      items.push({ outreachId: row.id, channel: row.channel, outcome: "failed", code: typeof extra.code === "string" ? extra.code : "error", error });
    }
  }
  const count = (o: SendAllItem["outcome"]) => items.filter((i) => i.outcome === o).length;
  return { items, summary: { sent: count("sent"), offline: count("offline"), failed: count("failed") }, remaining: rows.length - batch.length };
}
