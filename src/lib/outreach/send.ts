import type { Db } from "@/db/client";
import { approve, assertReviewedHash } from "@/lib/approvals";
import { getEnv, type Env } from "@/lib/env";
import { sendEmail, type EmailDeps } from "./email";
import { OutreachNotReadyError } from "./errors";
import { sendLetter, type SendDeps, type SendResult } from "./lob";
import { prepareSend } from "./payloads";
import { assertSendable, loadOutreach, outreachContentSha256 } from "./util";
import { placeCall, type VoiceDeps } from "./voice";
import { eq } from "drizzle-orm";
import { outreach } from "@/db/schema";

/**
 * Record an in-app approval for the exact payload that would be sent now. Does NOT send.
 * Email/voice recipients are allowlist-checked here so a bad address fails at approval time too.
 */
export async function approveOutreach(
  db: Db,
  outreachId: string,
  approvedBy: string,
  opts: { to?: string | null; env?: Env; expectedContentSha256?: string } = {},
) {
  const env = opts.env ?? getEnv();
  const row = await loadOutreach(db, outreachId);
  assertSendable(row, row.channel);
  assertReviewedHash(opts.expectedContentSha256, outreachContentSha256(row), "draft");
  const readiness = (row.tracking?.compose as { readiness?: { ready?: boolean; problems?: string[] } } | undefined)?.readiness;
  if (readiness && readiness.ready === false) throw new OutreachNotReadyError(readiness.problems ?? ["draft is not ready"]);
  const prepared = await prepareSend(db, row, { to: opts.to, env });
  const approval = await approve(db, {
    action: prepared.action,
    subjectId: outreachId,
    payload: prepared.payload,
    approvedBy,
  });
  const [saved] = await db
    .update(outreach)
    .set({ status: "approved", approvalId: approval.id, ...(prepared.to ? { toAddress: prepared.to } : {}) })
    .where(eq(outreach.id, outreachId))
    .returning();
  return { approvalId: approval.id, outreachId, status: saved!.status, payloadSha256: approval.payloadSha256 };
}

/** Run the channel executor (which itself asserts approval). */
export async function sendOutreach(
  db: Db,
  outreachId: string,
  opts: { to?: string | null; requestedBy?: string } & SendDeps & EmailDeps & VoiceDeps = {},
): Promise<SendResult> {
  const row = await loadOutreach(db, outreachId);
  switch (row.channel) {
    case "letter":
      return sendLetter(db, outreachId, opts.requestedBy, opts);
    case "email":
      return sendEmail(db, outreachId, opts.to ?? row.toAddress ?? "", opts);
    case "voice":
      return placeCall(db, outreachId, opts.to ?? row.toAddress ?? "", opts);
  }
}
