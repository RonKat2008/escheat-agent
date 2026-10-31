import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { insertFixture, STANDARD_ITEMS } from "@/lib/queries/test-fixtures";
import { runChatTurn } from "./agent";
import type { ChatEvent } from "./protocol";
import { normalizeMessages, scrubVolatile } from "./replay-key";

let t: TestDb;
let companyId: string;

beforeEach(async () => {
  vi.stubEnv("ESCHEAT_OFFLINE", "1");
  vi.stubEnv("ESCHEAT_RECORD", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("DEMO_ANCHOR_DATE", "2026-11-01");
  t = await createTestDb();
  companyId = (await insertFixture(t.db, STANDARD_ITEMS)).companyId;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await t.close();
});

async function ask(text: string): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  await runChatTurn({ db: t.db, companyId, messages: [{ role: "user", text }], emit: (e) => events.push(e) });
  return events;
}

describe("offline replay of committed chat cassettes", () => {
  // list_rules reads the versioned rule files, not the DB, so this recording replays on any database.
  it("replays 'Which rules are unverified?' end to end with no network and live tool results", async () => {
    const events = await ask("Which rules are unverified?");
    expect(events[0]).toMatchObject({ type: "start", offline: true });
    expect(events.find((e) => e.type === "error")).toBeUndefined();
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ name: "list_rules", ok: true, ui: { kind: "rules" } });
    const text = events.filter((e): e is Extract<ChatEvent, { type: "text" }> => e.type === "text").map((e) => e.delta).join("");
    expect(text.length).toBeGreaterThan(20);
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "end_turn" });
  });

  it("reports 'no recorded answer' for a prompt that was never recorded", async () => {
    const events = await ask("What is the weather in Paris?");
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "offline_unavailable" });
    expect(events.some((e) => e.type === "text")).toBe(false);
  });
});

describe("replay key normalization", () => {
  const uuidA = "0a1b2c3d-1111-4222-8333-444455556666";
  const uuidB = "ffffffff-aaaa-4bbb-8ccc-dddddddddddd";
  const convo = (id: string, uuid: string, stamp: string): Anthropic.MessageParam[] => [
    { role: "user", content: "Explain #1" },
    { role: "assistant", content: [{ type: "tool_use", id, name: "explain_item", input: { ref: uuid } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: `{"id":"${uuid}","createdAt":"${stamp}","amount":100}` }] },
  ];

  it("is identical across tool_use ids, row UUIDs and timestamps", () => {
    const a = normalizeMessages(convo("toolu_A", uuidA, "2026-01-01T10:00:00.000Z"));
    const b = normalizeMessages(convo("toolu_B", uuidB, "2030-05-05T01:02:03Z"));
    expect(a).toEqual(b);
  });

  it("still differs when the tool data differs (no stale narration over changed numbers)", () => {
    const a = normalizeMessages(convo("t", uuidA, "2026-01-01T10:00:00Z"));
    const b = normalizeMessages(convo("t", uuidA, "2026-01-01T10:00:00Z"));
    (b[2] as { content: { content: string }[] }).content[0]!.content = '{"amount":999}';
    expect(a).not.toEqual(b);
  });

  it("drops the prior-turn tool note and thinking blocks, and scrubs volatile text", () => {
    const [, assistant] = normalizeMessages([
      { role: "user", content: "hi" },
      { role: "assistant", content: "[Record of the tool results behind this reply, for reference]\nget_exposure({}) -> {}\n\nYou owe $1." },
    ]) as { content: string }[];
    expect(assistant!.content).toBe("You owe $1.");
    expect(scrubVolatile(`${uuidA} at 2026-11-01T00:00:00Z on 2026-11-01`)).toBe("<uuid> at <ts> on 2026-11-01");
  });
});
