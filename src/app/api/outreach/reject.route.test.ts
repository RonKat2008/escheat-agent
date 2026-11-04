import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { outreach } from "@/db/schema";
import { seedItem, TEST_SECRET } from "@/lib/outreach/testing";
import { loadOutreach, outreachContentSha256 } from "@/lib/outreach/util";

let t: TestDb;
vi.mock("@/lib/outreach/db", () => ({ getOutreachDb: async () => t.db }));
vi.mock("@/lib/agents/letter-writer", async (orig) => ({
  ...(await orig<typeof import("@/lib/agents/letter-writer")>()),
  draftLetterVariables: async () => {
    const { AnthropicNotConfigured } = await import("@/lib/llm/errors");
    throw new AnthropicNotConfigured();
  },
}));

import { POST as draftPost } from "./draft/route";
import { POST as approvePost } from "./[id]/approve/route";
import { POST as rejectPost } from "./[id]/reject/route";

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});
afterEach(() => vi.unstubAllEnvs());

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const reject = (id: string, body: Record<string, unknown>) => rejectPost(new Request("http://x", json(body)), ctx(id));

async function newDraft(): Promise<string> {
  vi.stubEnv("OWNER_LINK_SECRET", TEST_SECRET);
  vi.stubEnv("APP_BASE_URL", "https://escheat.test");
  vi.stubEnv("ESCHEAT_OFFLINE", "");
  vi.stubEnv("LOB_TEST_API_KEY", "");
  const { stale } = await seedItem(t.db, { ownerState: "CA" });
  const res = await draftPost(new Request("http://x/d", json({ staleItemId: stale.id, channel: "letter" })));
  return ((await res.json()) as { outreachId: string }).outreachId;
}

describe("POST /api/outreach/[id]/reject", () => {
  it("discards a draft: cancelled, with who, why and when kept on the row", async () => {
    const id = await newDraft();
    const res = await reject(id, { rejectedBy: "Dana Reyes", reason: "Wrong owner address" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outreachId: id, status: "cancelled" });
    const row = await loadOutreach(t.db, id);
    expect(row.status).toBe("cancelled");
    expect(row.tracking?.rejected).toMatchObject({ by: expect.stringContaining("Dana Reyes"), reason: "Wrong owner address", fromStatus: "draft" });
  });

  it("requires an approver name and a reason (400) and changes nothing", async () => {
    const id = await newDraft();
    expect((await reject(id, { reason: "not enough here" })).status).toBe(400);
    expect((await reject(id, { rejectedBy: "D", reason: "Wrong owner address" })).status).toBe(400);
    expect((await reject(id, { rejectedBy: "Dana Reyes", reason: "  " })).status).toBe(400);
    expect((await loadOutreach(t.db, id)).status).toBe("draft");
  });

  it("refuses an approved draft (409) and an unknown id (404)", async () => {
    const id = await newDraft();
    const hash = outreachContentSha256(await loadOutreach(t.db, id));
    const ok = await approvePost(new Request("http://x", json({ approvedBy: "Dana Reyes", expectedContentSha256: hash })), ctx(id));
    expect(ok.status).toBe(201);
    expect((await reject(id, { rejectedBy: "Dana Reyes", reason: "Changed my mind" })).status).toBe(409);
    expect((await t.db.select().from(outreach).where(eq(outreach.id, id)))[0]!.status).toBe("approved");
    expect((await reject(crypto.randomUUID(), { rejectedBy: "Dana Reyes", reason: "Changed my mind" })).status).toBe(404);
  });
});
