import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach } from "@/db/schema";
import { withApproval } from "@/lib/approvals";
import { getEnv, type Env } from "@/lib/env";
import { OutreachNotConfiguredError, OutreachProviderError, OutreachStateError, statusOf } from "./errors";
import { toSendResult, type SendResult } from "./lob";
import { prepareSend, type CallPayload } from "./payloads";
import { assertSendable, loadOutreach, markNeedsReconciliation, mergeTracking, type Tracking } from "./util";

/** Every call is a labeled simulation to an allowlisted number. */
export const SIMULATED_CALL_LABEL = "Simulated call";

export interface TranscriptTurn {
  role: string;
  message: string;
  timeInCallSecs?: number | null;
}

export interface ConversationSnapshot {
  status: string;
  transcript: TranscriptTurn[];
  summary?: string | null;
  durationSecs?: number | null;
}

export interface VoiceDeps {
  env?: Env;
  now?: () => Date;
  startCall?: (req: { apiKey: string; agentId: string; agentPhoneNumberId: string; payload: CallPayload; idempotencyKey: string }) => Promise<{
    conversationId: string;
    callSid?: string | null;
  }>;
  getConversation?: (req: { apiKey: string; conversationId: string }) => Promise<ConversationSnapshot>;
}

function missingKeys(env: Env): string[] {
  return (["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "ELEVENLABS_PHONE_NUMBER_ID"] as const).filter((k) => !env[k]);
}

async function defaultStartCall(req: {
  apiKey: string;
  agentId: string;
  agentPhoneNumberId: string;
  payload: CallPayload;
  idempotencyKey: string;
}): Promise<{ conversationId: string; callSid?: string | null }> {
  const { ElevenLabsClient } = await import("@elevenlabs/elevenlabs-js");
  try {
    const res = await new ElevenLabsClient({ apiKey: req.apiKey }).conversationalAi.twilio.outboundCall(
      {
        agentId: req.agentId,
        agentPhoneNumberId: req.agentPhoneNumberId,
        toNumber: req.payload.to,
        conversationInitiationClientData: { dynamicVariables: req.payload.dynamicVariables },
      },
      // maxRetries 0: the SDK default retries (2) could place the same call twice on a timeout. The header is
      // sent as a courtesy; our own guard is the persisted callAttempt marker below.
      { maxRetries: 0, headers: { "Idempotency-Key": req.idempotencyKey } },
    );
    if (!res.success || !res.conversationId) throw new Error(res.message || "call was not started");
    return { conversationId: res.conversationId, callSid: res.callSid ?? null };
  } catch (e) {
    throw new OutreachProviderError("elevenlabs", e instanceof Error ? e.message : String(e), statusOf(e));
  }
}

async function defaultGetConversation(req: { apiKey: string; conversationId: string }): Promise<ConversationSnapshot> {
  const { ElevenLabsClient } = await import("@elevenlabs/elevenlabs-js");
  try {
    const c = await new ElevenLabsClient({ apiKey: req.apiKey }).conversationalAi.conversations.get(req.conversationId);
    return {
      status: String(c.status),
      transcript: (c.transcript ?? []).map((t) => ({
        role: String(t.role),
        message: t.message ?? "",
        timeInCallSecs: (t as { timeInCallSecs?: number }).timeInCallSecs ?? null,
      })),
      summary: c.analysis?.transcriptSummary ?? null,
      durationSecs: c.metadata?.callDurationSecs ?? null,
    };
  } catch (e) {
    throw new OutreachProviderError("elevenlabs", e instanceof Error ? e.message : String(e));
  }
}

/** Place a SIMULATED outbound call (allowlisted number only) after in-app approval of the exact script. */
export async function placeCall(db: Db, outreachId: string, toNumber: string, deps: VoiceDeps = {}): Promise<SendResult> {
  const env = deps.env ?? getEnv();
  const now = deps.now ?? (() => new Date());
  const row = await loadOutreach(db, outreachId);
  assertSendable(row, "voice");
  const { payload, to } = await prepareSend(db, row, { to: toNumber, env });
  if (payload.kind !== "call") throw new Error("unreachable: call payload expected");

  return withApproval(db, { action: "place_call", subjectId: outreachId, payload }, async (approval, ctl) => {
    if (env.ESCHEAT_OFFLINE) {
      const [saved] = await db
        .update(outreach)
        .set({
          status: "approved",
          offline: true,
          toAddress: to,
          approvalId: approval.id,
          tracking: mergeTracking(row.tracking, {
            simulated: true,
            label: SIMULATED_CALL_LABEL,
            offlineResult: { offline: true, sent: false, note: "ESCHEAT_OFFLINE=1: no call was placed.", at: now().toISOString() },
          }),
        })
        .where(eq(outreach.id, outreachId))
        .returning();
      return toSendResult(saved!, false);
    }
    const missing = missingKeys(env);
    if (missing.length > 0) throw new OutreachNotConfiguredError("elevenlabs", missing);
    // Persist the attempt BEFORE dialing and refuse to dial twice for the same outreach (M4: no idempotency
    // key exists on the call API itself, so the marker is the guard).
    const idempotencyKey = `outreach-${outreachId}`;
    const fresh = await loadOutreach(db, outreachId);
    if (fresh.tracking?.callAttempt) {
      throw new OutreachStateError("locked", "A call attempt is already recorded for this outreach; reconcile it manually instead of dialing again.");
    }
    await db
      .update(outreach)
      .set({ tracking: mergeTracking(fresh.tracking, { callAttempt: { key: idempotencyKey, at: now().toISOString() } }) })
      .where(eq(outreach.id, outreachId));
    ctl.markAttempted();
    let started: { conversationId: string; callSid?: string | null };
    try {
      started = await (deps.startCall ?? defaultStartCall)({
        apiKey: env.ELEVENLABS_API_KEY!,
        agentId: env.ELEVENLABS_AGENT_ID!,
        agentPhoneNumberId: env.ELEVENLABS_PHONE_NUMBER_ID!,
        payload,
        idempotencyKey,
      });
    } catch (e) {
      if ((e as { sideEffectNotPerformed?: boolean }).sideEffectNotPerformed) {
        const cur = await loadOutreach(db, outreachId);
        const { callAttempt: _drop, ...rest } = (cur.tracking ?? {}) as Tracking;
        await db.update(outreach).set({ tracking: rest }).where(eq(outreach.id, outreachId));
      }
      throw e;
    }
    const [saved] = await db
      .update(outreach)
      .set({
        status: "sent",
        offline: false,
        sentAt: now(),
        toAddress: to,
        approvalId: approval.id,
        providerId: started.conversationId,
        tracking: mergeTracking(row.tracking, {
          simulated: true,
          label: SIMULATED_CALL_LABEL,
          call: { conversationId: started.conversationId, callSid: started.callSid ?? null },
        }),
      })
      .where(eq(outreach.id, outreachId))
      .returning();
    return toSendResult(saved!, true);
  }, { onUnknownOutcome: (err) => markNeedsReconciliation(db, outreachId, err, now()) });
}

export interface TranscriptResult {
  status: string;
  /** Null until the conversation is done (or when offline). */
  transcript: TranscriptTurn[] | null;
  stored: boolean;
}

/** Pull the conversation transcript and store it (labeled simulated) in outreach.tracking.response. */
export async function fetchCallTranscript(db: Db, outreachId: string, deps: VoiceDeps = {}): Promise<TranscriptResult> {
  const env = deps.env ?? getEnv();
  const now = deps.now ?? (() => new Date());
  const row = await loadOutreach(db, outreachId);
  if (row.channel !== "voice") throw new OutreachStateError("wrong_channel", `Outreach ${outreachId} is not a voice call.`);
  const conversationId = (row.tracking?.call as { conversationId?: string } | undefined)?.conversationId;
  if (!conversationId) {
    if (row.offline) return { status: "offline_not_placed", transcript: null, stored: false };
    throw new OutreachStateError("locked", `No call was placed for outreach ${outreachId}; nothing to fetch.`);
  }
  const missing = missingKeys(env);
  if (missing.length > 0) throw new OutreachNotConfiguredError("elevenlabs", missing);
  const convo = await (deps.getConversation ?? defaultGetConversation)({ apiKey: env.ELEVENLABS_API_KEY!, conversationId });
  if (convo.status !== "done") return { status: convo.status, transcript: null, stored: false };
  const response: Tracking = {
    channel: "voice",
    label: SIMULATED_CALL_LABEL,
    simulated: true,
    conversationId,
    transcript: convo.transcript,
    summary: convo.summary ?? null,
    durationSecs: convo.durationSecs ?? null,
    fetchedAt: now().toISOString(),
  };
  await db
    .update(outreach)
    .set({ tracking: mergeTracking(row.tracking, { response }) })
    .where(eq(outreach.id, outreachId));
  return { status: "done", transcript: convo.transcript, stored: true };
}
