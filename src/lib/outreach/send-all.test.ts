import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { outreach } from "@/db/schema";
import { AnthropicNotConfigured } from "@/lib/llm/errors";
import { composeLetter } from "@/lib/letters/compose";
import { approveOutreach } from "./send";
import { sendAllApproved } from "./send-all";
import { seedItem, testEnv } from "./testing";

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

async function composed() {
  const { stale, company } = await seedItem(t.db);
  const r = await composeLetter(t.db, stale.id, { env: testEnv(), draftVariables: failing });
  return { companyId: company.id, outreachId: r.outreachId };
}
const status = async (id: string) => (await t.db.select().from(outreach).where(eq(outreach.id, id)))[0]!.status;

describe("sendAllApproved", () => {
  it("offline: sends each approved letter through the gated path and labels it offline, never sent", async () => {
    const env = testEnv({ ESCHEAT_OFFLINE: "1" });
    const a = await composed();
    await approveOutreach(t.db, a.outreachId, "Reviewer", { env });
    const r = await sendAllApproved(t.db, a.companyId, { env });
    expect(r.summary).toEqual({ sent: 0, offline: 1, failed: 0 });
    expect(r.items[0]).toMatchObject({ outreachId: a.outreachId, outcome: "offline" });
    expect(await status(a.outreachId)).toBe("sent");
    expect((await t.db.select().from(outreach).where(eq(outreach.id, a.outreachId)))[0]!.offline).toBe(true);
  });

  it("leaves unapproved drafts alone, and a row marked approved without a real approval fails on its own", async () => {
    const env = testEnv({ LOB_TEST_API_KEY: "test_abc123" });
    const draft = await composed();
    const forged = await composed();
    await t.db.update(outreach).set({ status: "approved" }).where(eq(outreach.id, forged.outreachId));
    const createLetter = vi.fn(async () => ({ id: "ltr_1" }));
    const r1 = await sendAllApproved(t.db, draft.companyId, { env, createLetter });
    expect(r1.items).toEqual([]);
    expect(await status(draft.outreachId)).toBe("draft");
    const r2 = await sendAllApproved(t.db, forged.companyId, { env, createLetter });
    expect(r2.summary).toEqual({ sent: 0, offline: 0, failed: 1 });
    expect(r2.items[0]).toMatchObject({ outcome: "failed", code: "approval_required" });
    expect(createLetter).not.toHaveBeenCalled();
  });

  it("Lob test mode: an approved letter is mailed once and reported as sent", async () => {
    const env = testEnv({ LOB_TEST_API_KEY: "test_abc123" });
    const a = await composed();
    await approveOutreach(t.db, a.outreachId, "Reviewer", { env });
    const createLetter = vi.fn(async () => ({ id: "ltr_42" }));
    const r = await sendAllApproved(t.db, a.companyId, { env, createLetter });
    expect(r.summary).toEqual({ sent: 1, offline: 0, failed: 0 });
    expect(r.items[0]).toMatchObject({ outcome: "sent", providerId: "ltr_42" });
    expect(createLetter).toHaveBeenCalledTimes(1);
  });
});
