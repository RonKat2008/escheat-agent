import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach } from "@/db/schema";
import { withApproval } from "@/lib/approvals";
import { getEnv, type Env } from "@/lib/env";
import { OutreachNotConfiguredError, OutreachProviderError, OutreachStateError } from "./errors";
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

const VAPI_BASE_URL = "https://api.vapi.ai";
const VAPI_REQUEST_TIMEOUT_MS = 15_000;
/** Anthropic model for the inline (transient) assistant; listed in Vapi's AnthropicModel enum. */
export const VAPI_INLINE_MODEL = "claude-haiku-5-5";
/** Built-in Vapi voice name (the Vapi docs use "Clara" as their example). */
export const VAPI_INLINE_VOICE = "Clara";
const VAPI_MAX_CALL_SECONDS = 180;
const VAPI_MAX_TOKENS_PER_TURN = 250;

/**
 * The Vapi assistant is configured outside this repo. The recipient allowlist covers `customer.number` only, so an
 * assistant with a transferCall tool could bridge the call to a non-allowlisted party (review L8). Before every real
 * call with a saved assistant we read its config and refuse if it could transfer or if we cannot tell. Tools
 * referenced by `toolIds` / `toolRefs` live elsewhere and are not cheaply verifiable, so they fail closed too.
 */
export function transferToolProblems(assistant: unknown): string[] {
  if (!assistant || typeof assistant !== "object") return ["assistant configuration is empty or unreadable"];
  const a = assistant as {
    forwardingPhoneNumber?: unknown;
    hooks?: unknown;
    model?: {
      forwardingPhoneNumber?: unknown;
      toolIds?: unknown[];
      toolRefs?: unknown[];
      tools?: { type?: string; name?: string; function?: { name?: string } }[];
    };
  };
  const out: string[] = [];
  for (const t of a.model?.tools ?? []) {
    const name = t.function?.name ?? t.name ?? "";
    if (t.type === "transferCall") out.push(`tool "${name || "transferCall"}" is a transferCall tool`);
    else if (t.type === "handoff") out.push(`tool "${name || "handoff"}" is a handoff tool`);
    else if (/transfer/i.test(name)) out.push(`tool "${name}" looks like a transfer tool`);
  }
  if (a.forwardingPhoneNumber || a.model?.forwardingPhoneNumber) out.push("forwardingPhoneNumber is set");
  if ((a.model?.toolIds?.length ?? 0) > 0) out.push("model.toolIds is non-empty (referenced tools cannot be verified)");
  if ((a.model?.toolRefs?.length ?? 0) > 0) out.push("model.toolRefs is non-empty (referenced tools cannot be verified)");
  if (a.hooks && /transferCall/.test(JSON.stringify(a.hooks))) out.push("a hook invokes a transferCall tool");
  return out;
}

export class VoiceAgentUnsafeError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Refusing to place a call: the Vapi assistant is not safe for allowlisted calls (${problems.join("; ")}). Remove transfer tools and forwarding from the assistant.`);
    this.name = "VoiceAgentUnsafeError";
  }
}

/** One Vapi API call. Never retries. A rejected request carries its HTTP status; network errors and timeouts carry none. */
async function vapiRequest(
  req: { apiKey: string; fetch?: typeof fetch },
  path: string,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" },
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await (req.fetch ?? fetch)(`${VAPI_BASE_URL}${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${req.apiKey}`, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(VAPI_REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new OutreachProviderError("vapi", e instanceof Error ? e.message : String(e));
  }
  const text = await res.text().catch(() => "");
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const m = (json as { message?: unknown } | undefined)?.message;
    const detail = Array.isArray(m) ? m.join("; ") : typeof m === "string" ? m : text.slice(0, 200);
    throw new OutreachProviderError("vapi", `${res.status} ${detail || res.statusText}`.trim(), res.status);
  }
  if (!json || typeof json !== "object") throw new OutreachProviderError("vapi", "response was not a JSON object");
  return json as Record<string, unknown>;
}

/** GET /phone-number/{id}: proves the key and the number work (smoke check). */
export const fetchVapiPhoneNumber = (apiKey: string, phoneNumberId: string, fetchImpl?: typeof fetch) =>
  vapiRequest({ apiKey, fetch: fetchImpl }, `/phone-number/${encodeURIComponent(phoneNumberId)}`);

/** GET /assistant/{id}. */
export const fetchVapiAssistant = (apiKey: string, assistantId: string, fetchImpl?: typeof fetch) =>
  vapiRequest({ apiKey, fetch: fetchImpl }, `/assistant/${encodeURIComponent(assistantId)}`);

async function defaultVerifyAgent(req: { apiKey: string; assistantId: string; fetch?: typeof fetch }): Promise<string[]> {
  try {
    return transferToolProblems(await fetchVapiAssistant(req.apiKey, req.assistantId, req.fetch));
  } catch (e) {
    // Fail closed: if we cannot verify the assistant has no transfer tools we do not dial.
    return [`could not read the assistant configuration (${e instanceof Error ? e.message : String(e)})`];
  }
}

export interface VoiceDeps {
  /** Returns problems (empty = safe). Defaults to a live assistant-config check unless `startCall` is injected (tests). */
  verifyAgent?: (req: { apiKey: string; assistantId: string }) => Promise<string[]>;
  env?: Env;
  now?: () => Date;
  startCall?: (req: { apiKey: string; assistantId: string | null; phoneNumberId: string; payload: CallPayload; idempotencyKey: string }) => Promise<{
    conversationId: string;
    callSid?: string | null;
  }>;
  getConversation?: (req: { apiKey: string; conversationId: string }) => Promise<ConversationSnapshot>;
  /** Replaces global fetch in the default Vapi implementations (tests). */
  fetch?: typeof fetch;
}

function missingKeys(env: Env): string[] {
  return (["VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID"] as const).filter((k) => !env[k]);
}

/**
 * The transient assistant, derived deterministically from the approved payload (script + variables), so the approval
 * hash of the payload covers everything the assistant is told to say. No tools, no transfer, no forwarding number.
 */
export function buildInlineAssistant(payload: CallPayload) {
  const owner = payload.dynamicVariables.owner_name;
  const system = [
    `You are an automated voice assistant on a SIMULATED TEST call from a prototype (${SIMULATED_CALL_LABEL}). Say so if asked. This is not a real notice and not legal advice.`,
    "Say only what the approved script below says. Do not add claims, promises, deadlines, or statements about what any state will do.",
    "Never ask for or accept a Social Security number, bank account or routing number, card number, password, or any other sensitive identifier. If the person starts to give one, stop them and say you cannot take it.",
    "You cannot transfer the call or connect the person to anyone else. If asked, say you cannot.",
    "If you reach voicemail or the wrong person, or once the script is complete and the person has answered, thank them and end the call by saying goodbye.",
    "",
    "APPROVED SCRIPT:",
    payload.script,
  ].join("\n");
  return {
    name: "Escheat simulated call",
    firstMessage: `Hello, this is a simulated test call from a prototype. May I speak with ${owner || "the account owner"}?`,
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: "anthropic",
      model: VAPI_INLINE_MODEL,
      maxTokens: VAPI_MAX_TOKENS_PER_TURN,
      messages: [{ role: "system", content: system }],
    },
    voice: { provider: "vapi", voiceId: VAPI_INLINE_VOICE },
    endCallMessage: "Thank you. Goodbye.",
    endCallPhrases: ["goodbye"],
    maxDurationSeconds: VAPI_MAX_CALL_SECONDS,
  };
}

/** POST /call body: a saved assistant when approved with one, otherwise the inline assistant. */
export function buildCallRequest(req: { assistantId: string | null; phoneNumberId: string; payload: CallPayload }) {
  return {
    phoneNumberId: req.phoneNumberId,
    customer: { number: req.payload.to },
    ...(req.assistantId ? { assistantId: req.assistantId } : { assistant: buildInlineAssistant(req.payload) }),
    assistantOverrides: { variableValues: req.payload.dynamicVariables },
  };
}

async function defaultStartCall(
  req: { apiKey: string; assistantId: string | null; phoneNumberId: string; payload: CallPayload; idempotencyKey: string },
  fetchImpl?: typeof fetch,
): Promise<{ conversationId: string; callSid?: string | null }> {
  // Vapi's create-call API has no idempotency key and we never retry; our own guard is the persisted callAttempt
  // marker. Only a 4xx proves no call was created (OutreachProviderError.sideEffectNotPerformed).
  const call = await vapiRequest({ apiKey: req.apiKey, fetch: fetchImpl }, "/call", { method: "POST", body: buildCallRequest(req) });
  if (typeof call.id !== "string" || !call.id) throw new OutreachProviderError("vapi", "call was not started (no call id returned)");
  return { conversationId: call.id, callSid: typeof call.phoneCallProviderId === "string" ? call.phoneCallProviderId : null };
}

interface VapiMessage {
  role?: string;
  message?: string;
  content?: string;
  secondsFromStart?: number;
}

/** Only what was said: user turns and the assistant's ("bot") turns. System prompts and tool traffic are skipped. */
function toTranscript(messages: VapiMessage[]): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const m of messages) {
    const role = m.role === "user" ? "user" : m.role === "bot" || m.role === "assistant" ? "agent" : null;
    if (!role) continue;
    turns.push({ role, message: m.message ?? m.content ?? "", timeInCallSecs: m.secondsFromStart ?? null });
  }
  return turns;
}

async function defaultGetConversation(req: { apiKey: string; conversationId: string }, fetchImpl?: typeof fetch): Promise<ConversationSnapshot> {
  const c = (await vapiRequest({ apiKey: req.apiKey, fetch: fetchImpl }, `/call/${encodeURIComponent(req.conversationId)}`)) as {
    status?: string;
    messages?: VapiMessage[];
    artifact?: { messages?: VapiMessage[] };
    analysis?: { summary?: string };
    startedAt?: string;
    endedAt?: string;
  };
  const ms = c.startedAt && c.endedAt ? Date.parse(c.endedAt) - Date.parse(c.startedAt) : NaN;
  return {
    // Vapi: scheduled | queued | ringing | in-progress | forwarding | ended. "ended" is our "done".
    status: c.status === "ended" ? "done" : String(c.status),
    transcript: toTranscript(c.artifact?.messages ?? c.messages ?? []),
    summary: c.analysis?.summary ?? null,
    durationSecs: Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null,
  };
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
    if (missing.length > 0) throw new OutreachNotConfiguredError("vapi", missing);
    const verify = deps.verifyAgent ?? (deps.startCall ? undefined : (r: { apiKey: string; assistantId: string }) => defaultVerifyAgent({ ...r, fetch: deps.fetch }));
    // The inline assistant is built from the approved payload and has no tools; only a saved assistant needs checking.
    if (verify && payload.assistantId) {
      const problems = await verify({ apiKey: env.VAPI_API_KEY!, assistantId: payload.assistantId });
      if (problems.length > 0) throw new VoiceAgentUnsafeError(problems); // before markAttempted: approval is released
    }
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
      const startReq = {
        apiKey: env.VAPI_API_KEY!,
        assistantId: payload.assistantId,
        phoneNumberId: env.VAPI_PHONE_NUMBER_ID!,
        payload,
        idempotencyKey,
      };
      started = await (deps.startCall ?? ((r) => defaultStartCall(r, deps.fetch)))(startReq);
    } catch (e) {
      if ((e as { sideEffectNotPerformed?: boolean }).sideEffectNotPerformed) {
        const cur = await loadOutreach(db, outreachId);
        const rest: Tracking = { ...(cur.tracking ?? {}) };
        delete rest.callAttempt;
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
  /** Null until the call has ended (or when offline). */
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
  if (missing.length > 0) throw new OutreachNotConfiguredError("vapi", missing);
  const convo = await (deps.getConversation ?? ((r) => defaultGetConversation(r, deps.fetch)))({ apiKey: env.VAPI_API_KEY!, conversationId });
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
