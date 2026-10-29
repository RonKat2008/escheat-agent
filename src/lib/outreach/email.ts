import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach } from "@/db/schema";
import { withApproval } from "@/lib/approvals";
import { getEnv, type Env } from "@/lib/env";
import { OutreachNotConfiguredError, OutreachProviderError } from "./errors";
import { toSendResult, type SendResult } from "./lob";
import { prepareSend, type EmailPayload } from "./payloads";
import { assertSendable, loadOutreach, mergeTracking, previewPath } from "./util";

export interface EmailDeps {
  env?: Env;
  now?: () => Date;
  /** Injected in tests; the default uses the Resend SDK. Returns the Resend email id. */
  sendMail?: (req: { apiKey: string; payload: EmailPayload; idempotencyKey: string }) => Promise<{ id: string }>;
}

async function defaultSendMail(req: { apiKey: string; payload: EmailPayload; idempotencyKey: string }): Promise<{ id: string }> {
  const { Resend } = await import("resend");
  const p = req.payload;
  const { data, error } = await new Resend(req.apiKey).emails.send(
    {
      from: p.from,
      to: [p.to],
      subject: p.subject,
      html: p.html,
      text: p.text,
      tags: [{ name: "outreach_id", value: p.outreachId }],
    },
    { idempotencyKey: req.idempotencyKey },
  );
  if (error || !data) throw new OutreachProviderError("resend", error?.message ?? "no data returned");
  return { id: data.id };
}

/** Email an owner (allowlisted test recipients only) after in-app approval of the exact message. */
export async function sendEmail(db: Db, outreachId: string, to: string, deps: EmailDeps = {}): Promise<SendResult> {
  const env = deps.env ?? getEnv();
  const now = deps.now ?? (() => new Date());
  const row = await loadOutreach(db, outreachId);
  assertSendable(row, "email");
  // Allowlist is enforced inside prepareSend, before approval is consulted or any API is touched.
  const { payload, to: recipient } = await prepareSend(db, row, { to, env });
  if (payload.kind !== "email") throw new Error("unreachable: email payload expected");

  return withApproval(db, { action: "send_email", subjectId: outreachId, payload }, async (approval) => {
    if (env.ESCHEAT_OFFLINE) {
      const [saved] = await db
        .update(outreach)
        .set({
          status: "approved",
          offline: true,
          toAddress: recipient,
          approvalId: approval.id,
          previewUrl: previewPath(outreachId),
          tracking: mergeTracking(row.tracking, {
            offlineResult: { offline: true, sent: false, note: "ESCHEAT_OFFLINE=1: no email was sent.", at: now().toISOString() },
          }),
        })
        .where(eq(outreach.id, outreachId))
        .returning();
      return toSendResult(saved!, false);
    }
    if (!env.RESEND_API_KEY) throw new OutreachNotConfiguredError("resend", ["RESEND_API_KEY"]);
    const sent = await (deps.sendMail ?? defaultSendMail)({
      apiKey: env.RESEND_API_KEY,
      payload,
      idempotencyKey: `outreach-${outreachId}`,
    });
    const [saved] = await db
      .update(outreach)
      .set({
        status: "sent",
        offline: false,
        sentAt: now(),
        toAddress: recipient,
        approvalId: approval.id,
        providerId: sent.id,
        previewUrl: previewPath(outreachId),
        tracking: mergeTracking(row.tracking, { resend: { id: sent.id, from: payload.from } }),
      })
      .where(eq(outreach.id, outreachId))
      .returning();
    return toSendResult(saved!, true);
  });
}
