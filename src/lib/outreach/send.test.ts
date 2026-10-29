import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, outreach } from "@/db/schema";
import { approve, ApprovalRequiredError } from "@/lib/approvals";
import { AnthropicNotConfigured } from "@/lib/llm/errors";
import { composeLetter } from "@/lib/letters/compose";
import { draftOutreach } from "./draft";
import { sendEmail } from "./email";
import { LiveLobKeyError, RecipientNotAllowedError } from "./allowlist";
import { OutreachNotConfiguredError, OutreachNotReadyError, OutreachProviderError, OutreachStateError } from "./errors";
import { sendLetter } from "./lob";
import { prepareSend } from "./payloads";
import { approveOutreach, sendOutreach } from "./send";
import { seedItem, testEnv } from "./testing";
import { fetchCallTranscript, placeCall } from "./voice";

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
    await composeLetter(t.db, stale.id, { env: testEnv(), draftVariables: failing }); // new owner token => new html
    const createLetter = lobOk();
    await expect(sendLetter(t.db, outreachId, undefined, { env: lobKeyEnv, createLetter })).rejects.toBeInstanceOf(ApprovalRequiredError);
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

  it("provider failure releases the approval and stores nothing", async () => {
    const { outreachId } = await letterDraft();
    await approveLetter(outreachId);
    const boom = vi.fn(async () => {
      throw new OutreachProviderError("lob", "422 bad address");
    });
    await expect(sendLetter(t.db, outreachId, undefined, { env: lobKeyEnv, createLetter: boom })).rejects.toBeInstanceOf(OutreachProviderError);
    const [row] = await t.db.select().from(outreach).where(eq(outreach.id, outreachId));
    expect(row?.providerId).toBeNull();
    await expect(sendLetter(t.db, outreachId, undefined, { env: lobKeyEnv, createLetter: lobOk() })).resolves.toMatchObject({ sent: true });
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
  const mail = () => vi.fn(async (_r: unknown) => ({ id: "re_123" }));
  const env = testEnv({ RESEND_API_KEY: "re_key" });

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

  it("approval then edit => blocked; approved payload => sends and stores resend id", async () => {
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
    expect(sent.payload.from).toBe("Escheat Agent <noreply@escheat.test>");
    expect(sent.payload.html).toMatch(/https:\/\/escheat\.test\/owner\//);
    expect(sent.payload.text).toMatch(/\/owner\//);
    expect(res).toMatchObject({ sent: true, providerId: "re_123", status: "sent" });
  });

  it("not configured: RESEND_API_KEY missing, RESEND_FROM missing; offline never claims sent", async () => {
    const id = await emailDraft();
    const noKey = testEnv();
    await approveOutreach(t.db, id, "ronit", { to: "owner@example.com", env: noKey });
    await expect(sendEmail(t.db, id, "owner@example.com", { env: noKey, sendMail: mail() })).rejects.toMatchObject({ service: "resend", missing: ["RESEND_API_KEY"] });
    await expect(sendEmail(t.db, id, "owner@example.com", { env: testEnv({ RESEND_FROM: "", RESEND_API_KEY: "k" }), sendMail: mail() })).rejects.toBeInstanceOf(OutreachNotConfiguredError);

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

describe("placeCall / fetchCallTranscript", () => {
  async function voiceDraft() {
    const { stale } = await seedItem(t.db, { ownerState: "CA" });
    return (await draftOutreach(t.db, stale.id, "voice")).outreachId;
  }
  const keys = { ELEVENLABS_API_KEY: "xi", ELEVENLABS_AGENT_ID: "agent_1", ELEVENLABS_PHONE_NUMBER_ID: "phnum_1" };
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
    const arg = startCall.mock.calls[0]![0] as unknown as { payload: { to: string; simulated: boolean; dynamicVariables: Record<string, string> }; agentId: string };
    expect(arg.payload.to).toBe("+14155550100");
    expect(arg.payload.simulated).toBe(true);
    expect(arg.payload.dynamicVariables.owner_name).toBe("Bayline Electric");
    expect(arg.agentId).toBe("agent_1");
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

  it("missing keys => NotConfigured listing them; offline => not placed, no transcript", async () => {
    const id = await voiceDraft();
    const bare = testEnv();
    await approveOutreach(t.db, id, "ronit", { to: "+14155550100", env: bare });
    await expect(placeCall(t.db, id, "+14155550100", { env: bare, startCall: vi.fn() })).rejects.toMatchObject({
      name: "OutreachNotConfiguredError",
      missing: ["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "ELEVENLABS_PHONE_NUMBER_ID"],
    });
    const off = testEnv({ ESCHEAT_OFFLINE: "1" });
    const startCall = vi.fn();
    const r = await placeCall(t.db, id, "+14155550100", { env: off, startCall });
    expect(startCall).not.toHaveBeenCalled();
    expect(r).toMatchObject({ sent: false, offline: true });
    expect(await fetchCallTranscript(t.db, id, { env: off })).toMatchObject({ transcript: null, stored: false });
  });
});

describe("sendOutreach dispatcher", () => {
  it("routes by channel and requires `to` for email", async () => {
    const { stale } = await seedItem(t.db, { ownerState: "CA" });
    const { outreachId } = await draftOutreach(t.db, stale.id, "email", { env: testEnv(), draftVariables: failing });
    await expect(sendOutreach(t.db, outreachId, { env: testEnv() })).rejects.toBeInstanceOf(RecipientNotAllowedError);
  });
});
