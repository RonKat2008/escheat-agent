import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach } from "@/db/schema";
import { withApproval } from "@/lib/approvals";
import { getEnv, type Env } from "@/lib/env";
import { agentmailRequest } from "./agentmail";
import { OutreachNotConfiguredError, OutreachProviderError } from "./errors";
import { toSendResult, type SendResult } from "./lob";
import { prepareSend, type EmailPayload } from "./payloads";
import { assertSendable, loadOutreach, markNeedsReconciliation, mergeTracking, previewPath } from "./util";

export interface EmailDeps {
  env?: Env;
  now?: () => Date;
  /** Injected in tests; the default calls AgentMail over plain fetch. Returns the AgentMail message id. */
  sendMail?: (req: { apiKey: string; payload: EmailPayload; idempotencyKey: string; fetch?: typeof fetch }) => Promise<{ id: string; threadId?: string }>;
  /** Injected in tests; used by the default sendMail only. */
  fetch?: typeof fetch;
}

/**
 * POST /inboxes/{inbox_id}/messages/send. `payload.from` is the configured AGENTMAIL_INBOX_ID. Exactly one recipient
 * (the allowlisted `to`); cc/bcc are never set. The Idempotency-Key header makes a retry of the same outreach a no-op.
 */
async function defaultSendMail(req: { apiKey: string; payload: EmailPayload; idempotencyKey: string; fetch?: typeof fetch }): Promise<{ id: string; threadId?: string }> {
  const p = req.payload;
  const res = await agentmailRequest({ apiKey: req.apiKey, fetch: req.fetch }, `/inboxes/${encodeURIComponent(p.from)}/messages/send`, {
    method: "POST",
    headers: { "Idempotency-Key": req.idempotencyKey },
    body: { to: [p.to], subject: p.subject, text: p.text, html: p.html, labels: [`outreach-${p.outreachId}`] },
  });
  if (typeof res.message_id !== "string" || !res.message_id) throw new OutreachProviderError("agentmail", "no message_id returned");
  return { id: res.message_id, threadId: typeof res.thread_id === "string" ? res.thread_id : undefined };
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

  return withApproval(db, { action: "send_email", subjectId: outreachId, payload }, async (approval, ctl) => {
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
    if (!env.AGENTMAIL_API_KEY) throw new OutreachNotConfiguredError("agentmail", ["AGENTMAIL_API_KEY"]);
    ctl.markAttempted();
    const sent = await (deps.sendMail ?? defaultSendMail)({
      apiKey: env.AGENTMAIL_API_KEY,
      payload,
      idempotencyKey: `outreach-${outreachId}`,
      fetch: deps.fetch,
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
        tracking: mergeTracking(row.tracking, { agentmail: { messageId: sent.id, threadId: sent.threadId ?? null, inbox: payload.from } }),
      })
      .where(eq(outreach.id, outreachId))
      .returning();
    return toSendResult(saved!, true);
  }, { onUnknownOutcome: (err) => markNeedsReconciliation(db, outreachId, err, now()) });
}
