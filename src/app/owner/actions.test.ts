import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { staleItems } from "@/db/schema";
import { composeLetter } from "@/lib/letters/compose";
import { AnthropicNotConfigured } from "@/lib/llm/errors";
import { seedItem, TEST_SECRET, testEnv } from "@/lib/outreach/testing";

let t: TestDb;
vi.mock("@/lib/outreach/db", () => ({ getOutreachDb: async () => t.db }));
vi.mock("@/inngest/client", () => ({ inngest: { send: async () => {} } }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { submitOwnerResponse } from "./actions";

beforeAll(async () => {
  t = await createTestDb();
  vi.stubEnv("OWNER_LINK_SECRET", TEST_SECRET);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await t.close();
});

async function newToken() {
  const s = await seedItem(t.db);
  const r = await composeLetter(t.db, s.stale.id, {
    env: testEnv(),
    draftVariables: async () => {
      throw new AnthropicNotConfigured();
    },
  });
  return { staleId: s.stale.id, token: r.ownerUrl!.split("/owner/")[1]! };
}
const form = (o: Record<string, string | undefined>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) if (v !== undefined) fd.set(k, v);
  return fd;
};
const dest = async (fd: FormData) => {
  try {
    await submitOwnerResponse(fd);
  } catch (e) {
    return (e as Error).message.replace("REDIRECT:", "");
  }
  return "no-redirect";
};

describe("submitOwnerResponse (server action)", () => {
  it("each of the three actions redirects to done and updates the item", async () => {
    for (const [intent, status] of [
      ["already_cashed", "owner_responded"],
      ["send_money", "owner_responded"],
      ["confirm_address", "owner_responded"],
    ] as const) {
      const { token, staleId } = await newToken();
      const extra = intent === "confirm_address" ? { line1: "1 Main St", city: "Oakland", state: "CA", zip: "94607" } : {};
      expect(await dest(form({ token, intent, ...extra }))).toBe(`/owner/${token}?done=${intent}`);
      expect((await t.db.select().from(staleItems).where(eq(staleItems.id, staleId)))[0]?.status).toBe(status);
    }
  });

  it("incomplete address => error redirect, nothing consumed; reuse => bare link (page explains)", async () => {
    const { token } = await newToken();
    expect(await dest(form({ token, intent: "confirm_address", line1: "1 Main" }))).toBe(`/owner/${token}?error=address`);
    expect(await dest(form({ token, intent: "send_money" }))).toBe(`/owner/${token}?done=send_money`);
    expect(await dest(form({ token, intent: "send_money" }))).toBe(`/owner/${token}`);
  });

  it("bad intent and garbage token do not throw out of the action", async () => {
    const { token } = await newToken();
    expect(await dest(form({ token, intent: "delete_everything" }))).toBe(`/owner/${token}?error=invalid`);
    expect(await dest(form({ token: "garbage", intent: "send_money" }))).toBe(`/owner/garbage`);
  });
});
