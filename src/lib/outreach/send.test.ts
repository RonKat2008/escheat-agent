import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, outreach } from "@/db/schema";
import { approve, ApprovalRequiredError, OutcomeUnknownError } from "@/lib/approvals";
import { AnthropicNotConfigured } from "@/lib/llm/errors";
import { composeLetter } from "@/lib/letters/compose";
import { draftOutreach } from "./draft";
import { AGENTMAIL_INBOX_CLIENT_ID, createOrGetAgentMailInbox, getAgentMailInbox } from "./agentmail";
import { sendEmail } from "./email";
import { LiveLobKeyError, RecipientNotAllowedError } from "./allowlist";
import { OutreachNotConfiguredError, OutreachNotReadyError, OutreachProviderError, OutreachStateError } from "./errors";
import { sendLetter } from "./lob";
import { prepareSend } from "./payloads";
import { approveOutreach, sendOutreach } from "./send";
import { seedItem, testEnv } from "./testing";
import { buildInlineAssistant, fetchCallTranscript, placeCall, transferToolProblems, VAPI_INLINE_MODEL, VoiceAgentUnsafeError, type VoiceDeps } from "./voice";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

const failing = async () => {
  throw new AnthropicNotConfigured();
};
const lobKeyEnv = testEnv({ LOB_TEST_API_KEY: "test_abc123" });

async function letterDraft(state = "CA") {
  const { stale } = await seedItem(t.db, { ownerState: state });
  const r = await composeLetter(t.db, stale.id, { env: testEnv(), draftVariables: failing });
  return { ...r, stale };
}
async function approveLetter(id: string, env = lobKeyEnv) {
  return approveOutreach(t.db, id, "ronit", { env });
}
const lobOk = () => vi.fn(async (_r: unknown) => ({ id: "ltr_123", url: "https://lob.test/preview.pdf", expectedDeliveryDate: "2026-11-10", carrier: "USPS", trackingNumber: null }));

describe("sendLetter", () => {
  it("without approval: ApprovalRequiredError and NO Lob call", async () => {
    const { outreachId } = await letterDraft();
    const createLetter = lobOk();
    await expect(sendLetter(t.db, outreachId, undefined, { env: lobKeyEnv, createLetter })).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(createLetter).not.toHaveBeenCalled();
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, outreachId));
    expect(row?.status).toBe("draft");
  });

  it("approve records only; send then stores external id, preview url, status sent", async () => {
    const { outreachId } = await letterDraft();
    const createLetter = lobOk();
    const a = await approveLetter(outreachId);
    expect(createLetter).not.toHaveBeenCalled(); // approving never sends
    expect(a.status).toBe("approved");
    const res = await sendLetter(t.db, outreachId, "ronit", { env: lobKeyEnv, createLetter, now: () => new Date("2026-11-01T00:00:00Z") });
    expect(createLetter).toHaveBeenCalledTimes(1);
    const call = createLetter.mock.calls[0]![0] as unknown as { apiKey: string; idempotencyKey: string; payload: { html: string; to: { address_state: string } } };
    expect(call.apiKey).toBe("test_abc123");
    expect(call.idempotencyKey).toBe(`outreach-${outreachId}`);
    expect(call.payload.to.address_state).toBe("CA");
    expect(res).toMatchObject({ sent: true, offline: false, status: "sent", providerId: "ltr_123", previewUrl: "https://lob.test/preview.pdf" });
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, outreachId));
    expect(row).toMatchObject({ status: "sent", providerId: "ltr_123", previewUrl: "https://lob.test/preview.pdf", offline: false });
    expect(row?.sentAt).toBeInstanceOf(Date);
    expect(row?.approvalId).toBe(a.approvalId);
  });

  it("approval is single use: a second send is refused (already sent)", async () => {
    const { outreachId } = await letterDraft();
    await approveLetter(outreachId);
    await sendLetter(t.db, outreachId, undefined, { env: lobKeyEnv, createLetter: lobOk() });
    const again = lobOk();
    await expect(sendLetter(t.db, outreachId, undefined, { env: lobKeyEnv, createLetter: again })).rejects.toBeInstanceOf(OutreachStateError);
    expect(again).not.toHaveBeenCalled();
  });

  it("approval then body edit => blocked, no API call", async () => {
    const { outreachId } = await letterDraft();
    await approveLetter(outreachId);
    await t.db.update(outreach).set({ body: "<html><body>tampered</body></html>" }).where(eq(outreach.id, outreachId));
    const createLetter = lobOk();
    await expect(sendLetter(t.db, outreachId, undefined, { env: lobKeyEnv, createLetter })).rejects.toMatchObject({ name: "ApprovalRequiredError", reason: "payload_changed" });
    expect(createLetter).not.toHaveBeenCalled();
  });

  it("re-composing after approval invalidates the approval", async () => {
    const { outreachId, stale } = await letterDraft();
    await approveLetter(outreachId);
    const recomposed = await composeLetter(t.db, stale.id, { env: testEnv(), draftVariables: failing }); // M2: new draft row
    const createLetter = lobOk();
    // the approved row was cancelled (immutable), so it cannot be sent
    await expect(sendLetter(t.db, outreachId, undefined, { env: lobKeyEnv, createLetter })).rejects.toBeInstanceOf(OutreachStateError);
    // and the new version has no approval
    await expect(sendLetter(t.db, recomposed.outreachId, undefined, { env: lobKeyEnv, createLetter })).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(createLetter).not.toHaveBeenCalled();
  });

  it("live Lob key is refused (even with a valid approval), no API call", async () => {
    const { outreachId } = await letterDraft();
    await approveLetter(outreachId);
    const createLetter = lobOk();
    await expect(sendLetter(t.db, outreachId, undefined, { env: testEnv({ LOB_TEST_API_KEY: "live_abc" }), createLetter })).rejects.toBeInstanceOf(LiveLobKeyError);
    expect(createLetter).not.toHaveBeenCalled();
    // approval was released, not burned
    const [a] = await t.db.select().from(approvals).where(eq(approvals.subjectId, outreachId));
    expect(a?.consumedAt).toBeNull();
  });

  it("no key => typed NotConfigured, nothing marked sent; approval stays usable", async () => {
    const { outreachId } = await letterDraft();
    await approveLetter(outreachId);
    const createLetter = lobOk();
    await expect(sendLetter(t.db, outreachId, undefined, { env: testEnv(), createLetter })).rejects.toBeInstanceOf(OutreachNotConfiguredError);
    expect(createLetter).not.toHaveBeenCalled();
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, outreachId));
    expect(row?.status).toBe("approved");
    expect(row?.sentAt).toBeNull();
    // and once configured the same approval works
    await expect(sendLetter(t.db, outreachId, undefined, { env: lobKeyEnv, createLetter })).resolves.toMatchObject({ sent: true });
  });

  it("M4: a provider 4xx (proves nothing was sent) releases the approval and stores nothing", async () => {
    const { outreachId } = await letterDraft();
    await approveLetter(outreachId);
    const boom = vi.fn(async () => {
      throw new OutreachProviderError("lob", "422 bad address", 422);
    });
    await expect(sendLetter(t.db, outreachId, undefined, { env: lobKeyEnv, createLetter: boom })).rejects.toBeInstanceOf(OutreachProviderError);
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, outreachId));
    expect(row?.providerId).toBeNull();
    await expect(sendLetter(t.db, outreachId, undefined, { env: lobKeyEnv, createLetter: lobOk() })).resolves.toMatchObject({ sent: true });
  });

  it("M4: an ambiguous failure (timeout / 5xx) keeps the approval consumed and flags reconciliation; no second send", async () => {
    const { outreachId } = await letterDraft();
    const a = await approveLetter(outreachId);
    const timeout = vi.fn(async () => {
      throw new OutreachProviderError("lob", "socket hang up");
    });
    await expect(sendLetter(t.db, outreachId, undefined, { env: lobKeyEnv, createLetter: timeout })).rejects.toBeInstanceOf(OutcomeUnknownError);
    const [ap] = await t.db.select().from(approvals).where(eq(approvals.id, a.approvalId));
    expect(ap?.consumedAt).not.toBeNull();
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, outreachId));
    expect(row?.status).toBe("failed");
    expect((row?.tracking?.reconciliation as { required: boolean }).required).toBe(true);
    const retry = lobOk();
    await expect(sendLetter(t.db, outreachId, undefined, { env: lobKeyEnv, createLetter: retry })).rejects.toBeInstanceOf(OutreachStateError);
    expect(retry).not.toHaveBeenCalled();
  });

  it("offline: marks offline=true, local preview, never claims sent, no API call", async () => {
    const { outreachId } = await letterDraft();
    const env = testEnv({ ESCHEAT_OFFLINE: "1" }); // no Lob key at all
    await approveOutreach(t.db, outreachId, "ronit", { env });
    const createLetter = lobOk();
    const res = await sendLetter(t.db, outreachId, undefined, { env, createLetter });
    expect(createLetter).not.toHaveBeenCalled();
    expect(res).toMatchObject({ sent: false, offline: true, previewUrl: `/api/outreach/${outreachId}/preview` });
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, outreachId));
    expect(row).toMatchObject({ offline: true, providerId: null, sentAt: null });
    expect(row?.status).not.toBe("sent");
    expect(row?.status).not.toBe("delivered");
    expect((row?.tracking?.offlineResult as { sent: boolean }).sent).toBe(false);
  });

  it("offline with a live key present is still refused", async () => {
    const { outreachId } = await letterDraft();
    const env = testEnv({ ESCHEAT_OFFLINE: "1", LOB_TEST_API_KEY: "live_zzz" });
    await approveOutreach(t.db, outreachId, "ronit", { env });
    await expect(sendLetter(t.db, outreachId, undefined, { env })).rejects.toBeInstanceOf(LiveLobKeyError);
  });

  it("not-ready letter (TX unknown language) cannot be approved or sent", async () => {
    const { outreachId } = await letterDraft("TX");
    await expect(approveLetter(outreachId)).rejects.toBeInstanceOf(OutreachNotReadyError);
    await expect(sendLetter(t.db, outreachId, undefined, { env: lobKeyEnv, createLetter: lobOk() })).rejects.toBeInstanceOf(OutreachNotReadyError);
  });

  it("cannot forge an approval for a different payload", async () => {
    const { outreachId } = await letterDraft();
    await approve(t.db, { action: "mail_letter", subjectId: outreachId, payload: { kind: "letter", something: "else" }, approvedBy: "x" });
    await expect(sendLetter(t.db, outreachId, undefined, { env: lobKeyEnv, createLetter: lobOk() })).rejects.toMatchObject({ reason: "payload_changed" });
  });
});

describe("sendEmail", () => {
  async function emailDraft() {
    const { stale } = await seedItem(t.db, { ownerState: "CA" });
    const r = await draftOutreach(t.db, stale.id, "email", { env: testEnv(), draftVariables: failing });
    return r.outreachId;
  }
  const mail = () => vi.fn(async (_r: unknown) => ({ id: "msg_123", threadId: "thr_1" }));
  const env = testEnv({ AGENTMAIL_API_KEY: "am_key" });

  it("non-allowlisted recipient is blocked before approval or API", async () => {
    const id = await emailDraft();
    await expect(approveOutreach(t.db, id, "ronit", { to: "evil@example.com", env })).rejects.toBeInstanceOf(RecipientNotAllowedError);
    const sendMail = mail();
    await expect(sendEmail(t.db, id, "evil@example.com", { env, sendMail })).rejects.toBeInstanceOf(RecipientNotAllowedError);
    expect(sendMail).not.toHaveBeenCalled();
    // even with a (hand-made) approval for that address
    const row = (await t.db.select().from(outreach).where(eq(outreach.id, id)))[0]!;
    await expect(prepareSend(t.db, row, { to: "evil@example.com", env })).rejects.toBeInstanceOf(RecipientNotAllowedError);
  });

  it("without approval: ApprovalRequiredError, no API call", async () => {
    const id = await emailDraft();
    const sendMail = mail();
    await expect(sendEmail(t.db, id, "owner@example.com", { env, sendMail })).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("approval then edit => blocked; approved payload => sends and stores the AgentMail message id", async () => {
    const id = await emailDraft();
    await approveOutreach(t.db, id, "ronit", { to: "owner@example.com", env });
    await t.db.update(outreach).set({ subject: "changed" }).where(eq(outreach.id, id));
    const sendMail = mail();
    await expect(sendEmail(t.db, id, "owner@example.com", { env, sendMail })).rejects.toMatchObject({ reason: "payload_changed" });
    expect(sendMail).not.toHaveBeenCalled();

    const id2 = await emailDraft();
    await approveOutreach(t.db, id2, "ronit", { to: "Owner@Example.com", env });
    const res = await sendEmail(t.db, id2, "owner@example.com", { env, sendMail });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const sent = sendMail.mock.calls[0]![0] as unknown as { payload: { to: string; from: string; html: string; text: string } };
    expect(sent.payload.to).toBe("owner@example.com");
    expect(sent.payload.from).toBe("escheat-agent@agentmail.test");
    expect(sent.payload.html).toMatch(/https:\/\/escheat\.test\/owner\//);
    expect(sent.payload.text).toMatch(/\/owner\//);
    expect(res).toMatchObject({ sent: true, providerId: "msg_123", status: "sent" });
  });

  it("not configured: AGENTMAIL_API_KEY missing, AGENTMAIL_INBOX_ID missing; offline never claims sent", async () => {
    const id = await emailDraft();
    const noKey = testEnv();
    await approveOutreach(t.db, id, "ronit", { to: "owner@example.com", env: noKey });
    await expect(sendEmail(t.db, id, "owner@example.com", { env: noKey, sendMail: mail() })).rejects.toMatchObject({ service: "agentmail", missing: ["AGENTMAIL_API_KEY"] });
    const sendNoInbox = mail();
    await expect(sendEmail(t.db, id, "owner@example.com", { env: testEnv({ AGENTMAIL_INBOX_ID: "", AGENTMAIL_API_KEY: "k" }), sendMail: sendNoInbox })).rejects.toMatchObject({ service: "agentmail", missing: ["AGENTMAIL_INBOX_ID"] });
    expect(sendNoInbox).not.toHaveBeenCalled();

    const off = testEnv({ ESCHEAT_OFFLINE: "1" });
    const sendMail = mail();
    const r = await sendEmail(t.db, id, "owner@example.com", { env: off, sendMail });
    expect(sendMail).not.toHaveBeenCalled();
    expect(r).toMatchObject({ sent: false, offline: true });
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, id));
    expect(row).toMatchObject({ offline: true, providerId: null, sentAt: null });
    expect(row?.status).not.toBe("sent");
  });
});

describe("sendEmail against the AgentMail HTTP API (fetch stubbed)", () => {
  const env = testEnv({ AGENTMAIL_API_KEY: "am_key" });
  async function approvedEmail(e = env) {
    const { stale } = await seedItem(t.db, { ownerState: "CA" });
    const { outreachId } = await draftOutreach(t.db, stale.id, "email", { env: e, draftVariables: failing });
    await approveOutreach(t.db, outreachId, "ronit", { to: "owner@example.com", env: e });
    return outreachId;
  }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const calls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => ({ url: String(c[0]), init: c[1] as RequestInit }));

  it("POST /inboxes/{inbox}/messages/send with bearer auth, idempotency key, a single allowlisted recipient and no cc/bcc", async () => {
    const id = await approvedEmail();
    const f = vi.fn(async () => json(200, { message_id: "msg_1", thread_id: "thr_1" }));
    const res = await sendEmail(t.db, id, "owner@example.com", { env, fetch: f as unknown as typeof fetch });
    expect(res).toMatchObject({ sent: true, providerId: "msg_1" });
    expect(f).toHaveBeenCalledTimes(1);
    const c = calls(f)[0]!;
    expect(c.url).toBe("https://api.agentmail.to/v0/inboxes/escheat-agent%40agentmail.test/messages/send");
    expect(c.init.method).toBe("POST");
    const h = c.init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer am_key");
    expect(h["Idempotency-Key"]).toBe(`outreach-${id}`);
    const body = JSON.parse(String(c.init.body));
    expect(body).toMatchObject({ to: ["owner@example.com"], labels: [`outreach-${id}`] });
    expect(body.subject).toBeTruthy();
    expect(body.html).toMatch(/\/owner\//);
    expect(body.text).toMatch(/\/owner\//);
    expect(body).not.toHaveProperty("cc");
    expect(body).not.toHaveProperty("bcc");
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, id));
    expect(row?.tracking).toMatchObject({ agentmail: { messageId: "msg_1", threadId: "thr_1", inbox: "escheat-agent@agentmail.test" } });
  });

  it("non-allowlisted recipient never reaches fetch", async () => {
    const id = await approvedEmail();
    const f = vi.fn();
    await expect(sendEmail(t.db, id, "evil@example.com", { env, fetch: f as unknown as typeof fetch })).rejects.toBeInstanceOf(RecipientNotAllowedError);
    expect(f).not.toHaveBeenCalled();
  });

  it("4xx clears the attempt marker (retry allowed); 5xx keeps it and flags reconciliation; no retries", async () => {
    const id = await approvedEmail();
    const bad = vi.fn(async () => json(403, { name: "ForbiddenError", code: "missing_permission", message: "Forbidden" }));
    await expect(sendEmail(t.db, id, "owner@example.com", { env, fetch: bad as unknown as typeof fetch })).rejects.toMatchObject({ service: "agentmail", status: 403, sideEffectNotPerformed: true });
    expect(bad).toHaveBeenCalledTimes(1);
    let [row] = await t.db.select().from(outreach).where(eq(outreach.id, id));
    expect(row?.status).not.toBe("sent");
    expect(row?.tracking?.reconciliation).toBeUndefined();

    const down = vi.fn(async () => json(503, { message: "unavailable" }));
    await expect(sendEmail(t.db, id, "owner@example.com", { env, fetch: down as unknown as typeof fetch })).rejects.toBeInstanceOf(OutcomeUnknownError);
    expect(down).toHaveBeenCalledTimes(1);
    [row] = await t.db.select().from(outreach).where(eq(outreach.id, id));
    expect(row?.tracking).toMatchObject({ reconciliation: { required: true } });
  });

  it("409 (idempotency conflict) and network errors are unknown outcomes, not clean failures", async () => {
    const id = await approvedEmail();
    const conflict = vi.fn(async () => json(409, { name: "ConflictError", code: "conflict", message: "in progress" }));
    await expect(sendEmail(t.db, id, "owner@example.com", { env, fetch: conflict as unknown as typeof fetch })).rejects.toBeInstanceOf(OutcomeUnknownError);
    const id2 = await approvedEmail();
    const down = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await expect(sendEmail(t.db, id2, "owner@example.com", { env, fetch: down as unknown as typeof fetch })).rejects.toBeInstanceOf(OutcomeUnknownError);
  });

  it("a 200 without message_id is not treated as sent", async () => {
    const id = await approvedEmail();
    const f = vi.fn(async () => json(200, {}));
    await expect(sendEmail(t.db, id, "owner@example.com", { env, fetch: f as unknown as typeof fetch })).rejects.toBeInstanceOf(OutcomeUnknownError);
  });
});

describe("AgentMail inbox helpers (fetch stubbed)", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  it("createOrGet POSTs only the dedicated escheat-agent inbox with a client_id; get reads one inbox by id", async () => {
    const f = vi.fn(async () => json(200, { inbox_id: "escheat-agent@agentmail.to", email: "escheat-agent@agentmail.to", display_name: "Escheat Agent (prototype)" }));
    const inbox = await createOrGetAgentMailInbox("am_key", f as unknown as typeof fetch);
    expect(inbox.email).toBe("escheat-agent@agentmail.to");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.agentmail.to/v0/inboxes");
    expect(JSON.parse(String(init.body))).toEqual({ username: "escheat-agent", display_name: "Escheat Agent (prototype)", client_id: "escheat-agent-prototype-inbox" });
    expect(AGENTMAIL_INBOX_CLIENT_ID).not.toContain("@");

    await getAgentMailInbox("am_key", "escheat-agent@agentmail.to", f as unknown as typeof fetch);
    const [url2, init2] = f.mock.calls[1] as unknown as [string, RequestInit];
    expect(url2).toBe("https://api.agentmail.to/v0/inboxes/escheat-agent%40agentmail.to");
    expect(init2.method).toBe("GET");
  });

  it("a 404 surfaces as a provider error with its status", async () => {
    const f = vi.fn(async () => json(404, { name: "NotFoundError", code: "not_found", message: "Inbox not found" }));
    await expect(getAgentMailInbox("am_key", "x@y.z", f as unknown as typeof fetch)).rejects.toMatchObject({ service: "agentmail", status: 404 });
  });
});

describe("placeCall / fetchCallTranscript", () => {
  async function voiceDraft() {
    const { stale } = await seedItem(t.db, { ownerState: "CA" });
    return (await draftOutreach(t.db, stale.id, "voice")).outreachId;
  }
  const keys = { VAPI_API_KEY: "vapi-key", VAPI_PHONE_NUMBER_ID: "phnum_1" };
  const env = testEnv(keys);

  it("non-allowlisted number blocked before any API call", async () => {
    const id = await voiceDraft();
    const startCall = vi.fn();
    await expect(placeCall(t.db, id, "+14155559999", { env, startCall })).rejects.toBeInstanceOf(RecipientNotAllowedError);
    expect(startCall).not.toHaveBeenCalled();
  });

  it("without approval: blocked, no API call", async () => {
    const id = await voiceDraft();
    const startCall = vi.fn();
    await expect(placeCall(t.db, id, "415-555-0100", { env, startCall })).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(startCall).not.toHaveBeenCalled();
  });

  it("approved: places call, stores conversation id labeled simulated; transcript stored in response", async () => {
    const id = await voiceDraft();
    await approveOutreach(t.db, id, "ronit", { to: "+14155550100", env });
    const startCall = vi.fn(async (_r: unknown) => ({ conversationId: "conv_1", callSid: "CA1" }));
    const res = await placeCall(t.db, id, "(415) 555-0100", { env, startCall });
    const arg = startCall.mock.calls[0]![0] as unknown as { payload: { to: string; simulated: boolean; dynamicVariables: Record<string, string> }; assistantId: string | null; phoneNumberId: string };
    expect(arg.payload.to).toBe("+14155550100");
    expect(arg.payload.simulated).toBe(true);
    expect(arg.payload.dynamicVariables.owner_name).toBe("Bayline Electric");
    expect(arg.assistantId).toBeNull();
    expect(arg.phoneNumberId).toBe("phnum_1");
    expect(res).toMatchObject({ sent: true, providerId: "conv_1" });
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, id));
    expect(row?.tracking).toMatchObject({ simulated: true, label: "Simulated call", call: { conversationId: "conv_1" } });

    const inProgress = vi.fn(async () => ({ status: "in-progress", transcript: [] }));
    expect(await fetchCallTranscript(t.db, id, { env, getConversation: inProgress })).toMatchObject({ status: "in-progress", stored: false });
    const done = vi.fn(async () => ({ status: "done", transcript: [{ role: "agent", message: "Hello" }, { role: "user", message: "Yes, 1 Main St" }], summary: "Confirmed", durationSecs: 20 }));
    const tr = await fetchCallTranscript(t.db, id, { env, getConversation: done });
    expect(tr.stored).toBe(true);
    const [after] = await t.db.select().from(outreach).where(eq(outreach.id, id));
    expect(after?.tracking?.response).toMatchObject({ simulated: true, label: "Simulated call", conversationId: "conv_1" });
    expect((after?.tracking?.response as { transcript: unknown[] }).transcript).toHaveLength(2);
  });

  it("L8: transferToolProblems flags transfer tools, forwarding, toolIds and unreadable configs", () => {
    expect(transferToolProblems({ model: { tools: [{ type: "endCall" }] } })).toEqual([]);
    expect(transferToolProblems({ model: { tools: [{ type: "transferCall", destinations: [] }] } })).toHaveLength(1);
    expect(transferToolProblems({ model: { tools: [{ type: "function", function: { name: "Transfer_to_billing" } }] } })).toHaveLength(1);
    expect(transferToolProblems({ model: { tools: [{ type: "handoff" }] } })).toHaveLength(1);
    expect(transferToolProblems({ forwardingPhoneNumber: "+14155559999", model: {} })).toEqual(["forwardingPhoneNumber is set"]);
    expect(transferToolProblems({ model: { toolIds: ["tool_1"] } })).toHaveLength(1);
    expect(transferToolProblems({ model: { toolIds: [] } })).toEqual([]);
    expect(transferToolProblems(null)).toHaveLength(1); // fail closed
  });

  it("L8: an assistant with a transfer tool (or one we cannot read) blocks the call BEFORE dialing and keeps the approval usable", async () => {
    const id = await voiceDraft();
    const envA = testEnv({ ...keys, VAPI_ASSISTANT_ID: "asst_1" });
    await approveOutreach(t.db, id, "ronit", { to: "+14155550100", env: envA });
    const startCall = vi.fn(async (_r: unknown) => ({ conversationId: "c" }));
    const unsafe = vi.fn(async () => ["transfer_to_number tool is enabled"]);
    await expect(placeCall(t.db, id, "+14155550100", { env: envA, startCall, verifyAgent: unsafe })).rejects.toBeInstanceOf(VoiceAgentUnsafeError);
    expect(startCall).not.toHaveBeenCalled();
    await expect(placeCall(t.db, id, "+14155550100", { env: envA, startCall, verifyAgent: async () => [] })).resolves.toMatchObject({ sent: true });
  });

  it("M4: voice passes an idempotency key and never dials twice after an ambiguous failure", async () => {
    const id = await voiceDraft();
    await approveOutreach(t.db, id, "ronit", { to: "+14155550100", env });
    const startCall = vi.fn(async (_r: unknown) => {
      throw new OutreachProviderError("vapi", "gateway timeout", 504);
    });
    await expect(placeCall(t.db, id, "+14155550100", { env, startCall })).rejects.toBeInstanceOf(OutcomeUnknownError);
    expect((startCall.mock.calls[0]![0] as { idempotencyKey: string }).idempotencyKey).toBe(`outreach-${id}`);
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, id));
    expect(row?.status).toBe("failed");
    expect(row?.tracking).toMatchObject({ callAttempt: { key: `outreach-${id}` }, reconciliation: { required: true } });
    const again = vi.fn();
    await expect(placeCall(t.db, id, "+14155550100", { env, startCall: again })).rejects.toBeInstanceOf(OutreachStateError);
    expect(again).not.toHaveBeenCalled();
  });

  it("M4: voice 4xx before the call exists releases the approval and clears the attempt marker", async () => {
    const id = await voiceDraft();
    await approveOutreach(t.db, id, "ronit", { to: "+14155550100", env });
    const bad = vi.fn(async () => {
      throw new OutreachProviderError("vapi", "invalid agent", 422);
    });
    await expect(placeCall(t.db, id, "+14155550100", { env, startCall: bad })).rejects.toBeInstanceOf(OutreachProviderError);
    const ok = vi.fn(async () => ({ conversationId: "conv_9", callSid: null }));
    await expect(placeCall(t.db, id, "+14155550100", { env, startCall: ok })).resolves.toMatchObject({ sent: true });
  });

  it("missing keys => NotConfigured listing them; offline => not placed, no transcript", async () => {
    const id = await voiceDraft();
    const bare = testEnv();
    await approveOutreach(t.db, id, "ronit", { to: "+14155550100", env: bare });
    await expect(placeCall(t.db, id, "+14155550100", { env: bare, startCall: vi.fn() })).rejects.toMatchObject({
      name: "OutreachNotConfiguredError",
      missing: ["VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID"],
    });
    const off = testEnv({ ESCHEAT_OFFLINE: "1" });
    const startCall = vi.fn();
    const r = await placeCall(t.db, id, "+14155550100", { env: off, startCall });
    expect(startCall).not.toHaveBeenCalled();
    expect(r).toMatchObject({ sent: false, offline: true });
    expect(await fetchCallTranscript(t.db, id, { env: off })).toMatchObject({ transcript: null, stored: false });
  });
});

describe("placeCall against the Vapi HTTP API (fetch stubbed)", () => {
  const env = testEnv({ VAPI_API_KEY: "vapi-key", VAPI_PHONE_NUMBER_ID: "phnum_1" });
  async function approvedVoice(e = env) {
    const { stale } = await seedItem(t.db, { ownerState: "CA" });
    const { outreachId } = await draftOutreach(t.db, stale.id, "voice");
    await approveOutreach(t.db, outreachId, "ronit", { to: "+14155550100", env: e });
    return outreachId;
  }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const calls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => ({ url: String(c[0]), init: c[1] as RequestInit }));

  it("inline assistant: POST /call with bearer auth, tool-free anthropic assistant, no assistantId", async () => {
    const id = await approvedVoice();
    const f = vi.fn(async () => json(201, { id: "call_1", status: "queued" }));
    const res = await placeCall(t.db, id, "+14155550100", { env, fetch: f as unknown as typeof fetch });
    expect(res).toMatchObject({ sent: true, providerId: "call_1" });
    expect(f).toHaveBeenCalledTimes(1); // no verify GET, no retry
    const [c] = calls(f);
    expect(c!.url).toBe("https://api.vapi.ai/call");
    expect(c!.init.method).toBe("POST");
    expect((c!.init.headers as Record<string, string>).Authorization).toBe("Bearer vapi-key");
    const body = JSON.parse(String(c!.init.body)) as {
      assistantId?: string;
      assistantOverrides: { variableValues: Record<string, string> };
      assistant: Record<string, unknown> & { model: Record<string, unknown> & { messages: { content: string }[] } };
    };
    expect(body).toMatchObject({ phoneNumberId: "phnum_1", customer: { number: "+14155550100" } });
    expect(body.assistantId).toBeUndefined();
    expect(body.assistantOverrides.variableValues.owner_name).toBe("Bayline Electric");
    expect(body.assistant.model).toMatchObject({ provider: "anthropic", model: VAPI_INLINE_MODEL });
    expect(body.assistant.model.messages[0]!.content).toContain("SIMULATED TEST");
    expect(body.assistant.model.messages[0]!.content).toContain("Social Security");
    for (const k of ["tools", "toolIds", "forwardingPhoneNumber"]) {
      expect(body.assistant[k]).toBeUndefined();
      expect(body.assistant.model[k]).toBeUndefined();
    }
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, id));
    expect(row?.tracking).toMatchObject({ simulated: true, call: { conversationId: "call_1" } });
  });

  it("the inline assistant is a pure function of the approved payload", async () => {
    const { stale } = await seedItem(t.db, { ownerState: "CA" });
    const { outreachId } = await draftOutreach(t.db, stale.id, "voice");
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, outreachId));
    const p = (await prepareSend(t.db, row!, { to: "+14155550100", env })).payload;
    if (p.kind !== "call") throw new Error("call payload expected");
    expect(buildInlineAssistant(p)).toEqual(buildInlineAssistant(structuredClone(p)));
  });

  it("saved assistant: reads it first, then POSTs assistantId instead of an inline assistant", async () => {
    const envA = testEnv({ VAPI_API_KEY: "vapi-key", VAPI_PHONE_NUMBER_ID: "phnum_1", VAPI_ASSISTANT_ID: "asst_1" });
    const id = await approvedVoice(envA);
    const f = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith("/assistant/asst_1") ? json(200, { id: "asst_1", model: { tools: [{ type: "endCall" }] } }) : json(201, { id: "call_2", status: "queued" }),
    );
    await placeCall(t.db, id, "+14155550100", { env: envA, fetch: f as unknown as typeof fetch });
    const c = calls(f);
    expect(c.map((x) => `${x.init.method} ${x.url}`)).toEqual(["GET https://api.vapi.ai/assistant/asst_1", "POST https://api.vapi.ai/call"]);
    const body = JSON.parse(String(c[1]!.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ assistantId: "asst_1", customer: { number: "+14155550100" } });
    expect(body.assistant).toBeUndefined();
  });

  it.each([
    ["a transferCall tool", { model: { tools: [{ type: "transferCall" }] } }],
    ["a forwardingPhoneNumber", { forwardingPhoneNumber: "+14155559999", model: {} }],
    ["toolIds", { model: { toolIds: ["tool_1"] } }],
  ])("saved assistant with %s: refused before POST /call, approval still usable", async (_n, assistant) => {
    const envA = testEnv({ VAPI_API_KEY: "vapi-key", VAPI_PHONE_NUMBER_ID: "phnum_1", VAPI_ASSISTANT_ID: "asst_1" });
    const id = await approvedVoice(envA);
    const f = vi.fn(async () => json(200, assistant));
    await expect(placeCall(t.db, id, "+14155550100", { env: envA, fetch: f as unknown as typeof fetch })).rejects.toBeInstanceOf(VoiceAgentUnsafeError);
    expect(calls(f).some((x) => x.init.method === "POST")).toBe(false);
  });

  it("saved assistant that cannot be fetched: fail closed, no POST /call", async () => {
    const envA = testEnv({ VAPI_API_KEY: "vapi-key", VAPI_PHONE_NUMBER_ID: "phnum_1", VAPI_ASSISTANT_ID: "asst_1" });
    const id = await approvedVoice(envA);
    const f = vi.fn(async () => json(404, { message: "Not Found" }));
    await expect(placeCall(t.db, id, "+14155550100", { env: envA, fetch: f as unknown as typeof fetch })).rejects.toThrow(/could not read the assistant configuration/);
    expect(calls(f).some((x) => x.init.method === "POST")).toBe(false);
  });

  it("non-allowlisted number never reaches fetch", async () => {
    const id = await approvedVoice();
    const f = vi.fn();
    await expect(placeCall(t.db, id, "+14155559999", { env, fetch: f as unknown as typeof fetch })).rejects.toBeInstanceOf(RecipientNotAllowedError);
    expect(f).not.toHaveBeenCalled();
  });

  it("4xx from POST /call clears the attempt marker (retry allowed); 5xx keeps it and flags reconciliation; no retries", async () => {
    const id = await approvedVoice();
    const bad = vi.fn(async () => json(400, { message: ["customer.number must be valid"] }));
    await expect(placeCall(t.db, id, "+14155550100", { env, fetch: bad as unknown as typeof fetch })).rejects.toMatchObject({ service: "vapi", status: 400, sideEffectNotPerformed: true });
    expect(bad).toHaveBeenCalledTimes(1);
    let [row] = await t.db.select().from(outreach).where(eq(outreach.id, id));
    expect(row?.tracking?.callAttempt).toBeUndefined();

    const down = vi.fn(async () => json(503, { message: "unavailable" }));
    await expect(placeCall(t.db, id, "+14155550100", { env, fetch: down as unknown as typeof fetch })).rejects.toBeInstanceOf(OutcomeUnknownError);
    expect(down).toHaveBeenCalledTimes(1);
    [row] = await t.db.select().from(outreach).where(eq(outreach.id, id));
    expect(row?.tracking).toMatchObject({ callAttempt: { key: `outreach-${id}` }, reconciliation: { required: true } });

    const again = vi.fn();
    await expect(placeCall(t.db, id, "+14155550100", { env, fetch: again as unknown as typeof fetch })).rejects.toBeInstanceOf(OutreachStateError);
    expect(again).not.toHaveBeenCalled();
  });

  it("network error / timeout keeps the marker (unknown outcome)", async () => {
    const id = await approvedVoice();
    const f = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await expect(placeCall(t.db, id, "+14155550100", { env, fetch: f as unknown as typeof fetch })).rejects.toBeInstanceOf(OutcomeUnknownError);
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, id));
    expect(row?.tracking?.callAttempt).toBeDefined();
  });

  it("transcript: GET /call/{id} maps ended -> done, bot -> agent, skips system and tool messages", async () => {
    const id = await approvedVoice();
    await placeCall(t.db, id, "+14155550100", { env, fetch: vi.fn(async () => json(201, { id: "call_3", status: "queued" })) as unknown as typeof fetch });
    const running = vi.fn(async () => json(200, { id: "call_3", status: "in-progress" }));
    expect(await fetchCallTranscript(t.db, id, { env, fetch: running as unknown as typeof fetch })).toMatchObject({ status: "in-progress", transcript: null, stored: false });

    const ended = vi.fn(async () =>
      json(200, {
        id: "call_3",
        status: "ended",
        startedAt: "2026-11-01T10:00:00.000Z",
        endedAt: "2026-11-01T10:00:20.000Z",
        analysis: { summary: "Confirmed address" },
        artifact: {
          messages: [
            { role: "system", message: "prompt", secondsFromStart: 0 },
            { role: "bot", message: "Hello", secondsFromStart: 1.5 },
            { role: "tool_calls", message: "", secondsFromStart: 2 },
            { role: "user", message: "Yes, 1 Main St", secondsFromStart: 4 },
          ],
        },
      }),
    );
    const r = await fetchCallTranscript(t.db, id, { env, fetch: ended as unknown as typeof fetch });
    expect(r).toMatchObject({ status: "done", stored: true });
    expect(r.transcript).toEqual([
      { role: "agent", message: "Hello", timeInCallSecs: 1.5 },
      { role: "user", message: "Yes, 1 Main St", timeInCallSecs: 4 },
    ]);
    expect(calls(ended)[0]!.url).toBe("https://api.vapi.ai/call/call_3");
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, id));
    expect(row?.tracking?.response).toMatchObject({ summary: "Confirmed address", durationSecs: 20, simulated: true });
  });

  it("falls back to top-level messages when artifact.messages is absent", async () => {
    const id = await approvedVoice();
    await placeCall(t.db, id, "+14155550100", { env, fetch: vi.fn(async () => json(201, { id: "call_4" })) as unknown as typeof fetch });
    const f = vi.fn(async () => json(200, { status: "ended", messages: [{ role: "bot", message: "Hi", secondsFromStart: 0 }] }));
    const r = await fetchCallTranscript(t.db, id, { env, fetch: f as unknown as typeof fetch } satisfies VoiceDeps);
    expect(r.transcript).toEqual([{ role: "agent", message: "Hi", timeInCallSecs: 0 }]);
  });
});

describe("sendOutreach dispatcher", () => {
  it("routes by channel and requires `to` for email", async () => {
    const { stale } = await seedItem(t.db, { ownerState: "CA" });
    const { outreachId } = await draftOutreach(t.db, stale.id, "email", { env: testEnv(), draftVariables: failing });
    await expect(sendOutreach(t.db, outreachId, { env: testEnv() })).rejects.toBeInstanceOf(RecipientNotAllowedError);
  });
});
