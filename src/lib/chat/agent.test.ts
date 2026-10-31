import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { agentRuns, approvals } from "@/db/schema";
import { message } from "@/lib/llm/testing";
import { insertFixture, STANDARD_ITEMS } from "@/lib/queries/test-fixtures";
import { chatAvailability, runChatTurn, setChatClient, toApiMessages, type ChatClient, type ChatStream } from "./agent";
import { ChatRequestSchema, CHAT_LIMITS, decodeEvents, encodeEvent, type ChatEvent } from "./protocol";
import { consumeChatTurn, resetChatLimiter, CHAT_BURST } from "./rate-limit";

/** A scripted stream: emits text deltas for each text block, then resolves finalMessage(). */
function scriptedStream(msg: Anthropic.Message): ChatStream {
  const events: Anthropic.MessageStreamEvent[] = [];
  msg.content.forEach((b, index) => {
    if (b.type === "text") {
      events.push({ type: "content_block_start", index, content_block: { type: "text", text: "", citations: null } } as Anthropic.MessageStreamEvent);
      for (const piece of b.text.match(/.{1,6}/gs) ?? []) {
        events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: piece } } as Anthropic.MessageStreamEvent);
      }
    }
  });
  return {
    async *[Symbol.asyncIterator]() {
      yield* events;
    },
    finalMessage: async () => msg,
  };
}

function scriptedClient(script: Anthropic.Message[]): ChatClient & { bodies: Anthropic.MessageStreamParams[] } {
  const bodies: Anthropic.MessageStreamParams[] = [];
  let i = 0;
  return {
    bodies,
    messages: {
      stream(body) {
        bodies.push(JSON.parse(JSON.stringify(body)));
        const next = script[i++];
        if (!next) throw new Error(`no scripted response #${i}`);
        return scriptedStream(next);
      },
    },
  };
}

let t: TestDb;
let companyId: string;

beforeEach(async () => {
  vi.stubEnv("DEMO_ANCHOR_DATE", "2026-11-01");
  vi.stubEnv("ESCHEAT_OFFLINE", "");
  vi.stubEnv("ESCHEAT_RECORD", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  t = await createTestDb();
  companyId = (await insertFixture(t.db, STANDARD_ITEMS)).companyId;
});
afterEach(async () => {
  setChatClient(undefined);
  vi.unstubAllEnvs();
  await t.close();
});

async function run(client: ChatClient, text = "What do we owe and where?") {
  setChatClient(client);
  const events: ChatEvent[] = [];
  await runChatTurn({ db: t.db, companyId, messages: [{ role: "user", text }], emit: (e) => events.push(e) });
  return events;
}

describe("runChatTurn", () => {
  it("text -> tool_use -> tool_result -> final text produces the right event stream and logs one agent run", async () => {
    const client = scriptedClient([
      message([
        { type: "text", text: "Let me check." },
        { type: "tool_use", id: "toolu_1", name: "get_exposure", input: {} },
      ]),
      message([{ type: "text", text: "You owe **$3,100.50** across 3 states." }], { usage: { input_tokens: 200, output_tokens: 40 } }),
    ]);
    const events = await run(client);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("start");
    expect(types.at(-1)).toBe("done");
    const toolStart = types.indexOf("tool_start");
    const toolResult = types.indexOf("tool_result");
    expect(toolStart).toBeGreaterThan(0);
    expect(toolResult).toBeGreaterThan(toolStart);
    expect(types.lastIndexOf("text")).toBeGreaterThan(toolResult);

    const result = events.find((e) => e.type === "tool_result");
    expect(result).toMatchObject({ name: "get_exposure", ok: true, ui: { kind: "exposure" } });
    const text = events.filter((e): e is Extract<ChatEvent, { type: "text" }> => e.type === "text").map((e) => e.delta).join("");
    expect(text).toBe("Let me check.\n\nYou owe **$3,100.50** across 3 states.");

    // Second request carries the assistant tool_use turn and a user tool_result with compact data (no UI payload).
    const second = client.bodies[1]!;
    expect(second.messages).toHaveLength(3);
    const toolResultBlock = (second.messages[2]!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(toolResultBlock.type).toBe("tool_result");
    expect(toolResultBlock.tool_use_id).toBe("toolu_1");
    expect(String(toolResultBlock.content)).toContain("$3,100.50");
    expect(String(toolResultBlock.content)).not.toContain('"kind"');
    expect(client.bodies[0]!.tools?.length).toBeGreaterThan(10);
    expect(client.bodies[0]!.output_config).toEqual({ effort: "low" });

    const done = events.at(-1) as Extract<ChatEvent, { type: "done" }>;
    expect(done.toolContext).toContain("get_exposure({})");
    expect(done.usage.inputTokens).toBe(300);
    const [row] = await t.db.select().from(agentRuns);
    expect(row).toMatchObject({ agent: "chat", status: "succeeded", inputTokens: 300, outputTokens: 90 });
    expect(row!.id).toBe(done.runId);
  });

  it("invalid tool input becomes an is_error tool_result the model can recover from", async () => {
    const client = scriptedClient([
      message([{ type: "tool_use", id: "toolu_x", name: "upcoming_deadlines", input: { days: -4 } }]),
      message([{ type: "text", text: "Sorry, let me retry." }]),
    ]);
    const events = await run(client);
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ ok: false, ui: { kind: "error" } });
    const block = (client.bodies[1]!.messages[2]!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(block.is_error).toBe(true);
  });

  it("a model that tries to approve finds no such tool, and nothing is approved", async () => {
    const client = scriptedClient([
      message([{ type: "tool_use", id: "toolu_a", name: "approve_outreach", input: { id: "x", approvedBy: "model" } }]),
      message([{ type: "text", text: "I cannot approve; please approve in the app." }]),
    ]);
    const events = await run(client, "Approve the letter for me");
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ ok: false });
    expect(await t.db.select().from(approvals)).toHaveLength(0);
  });

  it("stops at the per-turn model call cap", async () => {
    const loop = Array.from({ length: CHAT_LIMITS.maxModelCalls + 1 }, (_, i) =>
      message([{ type: "tool_use", id: `toolu_${i}`, name: "get_clock", input: {} }]),
    );
    const events = await run(scriptedClient(loop));
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "turn_limit" });
    const [row] = await t.db.select().from(agentRuns);
    expect(row!.status).toBe("failed");
  });

  it("refusals and API failures become honest error events", async () => {
    const refused = await run(scriptedClient([message([], { stop_reason: "refusal" })]));
    expect(refused.find((e) => e.type === "error")).toMatchObject({ code: "refusal" });
    const broken: ChatClient = {
      messages: {
        stream() {
          throw new Error("boom");
        },
      },
    };
    const failed = await run(broken);
    expect(failed.find((e) => e.type === "error")).toMatchObject({ code: "model_error" });
    expect(failed.at(-1)?.type).toBe("done");
  });

  it("offline mode without a recording reports unavailable instead of answering", async () => {
    vi.stubEnv("ESCHEAT_OFFLINE", "1");
    const events = await run(scriptedClient([]));
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "offline_unavailable" });
    expect(events.some((e) => e.type === "text")).toBe(false);
  });
});

describe("availability", () => {
  it("is not_configured without a key, ready with an injected client, offline when ESCHEAT_OFFLINE=1", () => {
    expect(chatAvailability()).toBe("not_configured");
    setChatClient(scriptedClient([]));
    expect(chatAvailability()).toBe("ready");
    vi.stubEnv("ESCHEAT_OFFLINE", "1");
    expect(chatAvailability()).toBe("offline");
  });
});

describe("request validation and limits", () => {
  it("accepts a normal conversation and maps assistant tool context into the transcript", () => {
    const body = ChatRequestSchema.parse({
      messages: [
        { role: "user", text: "Explain #10482" },
        { role: "assistant", text: "Here it is.", toolContext: "explain_item({...}) -> {...}" },
        { role: "user", text: "Draft the letter" },
      ],
    });
    const api = toApiMessages(body.messages);
    expect(api[1]!.content).toContain("explain_item");
    expect(api[1]!.content).toContain("Here it is.");
  });

  it("rejects bad shapes, wrong ordering and oversize input", () => {
    expect(ChatRequestSchema.safeParse({}).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ messages: [] }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ messages: [{ role: "assistant", text: "hi" }] }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ messages: [{ role: "user", text: "a" }, { role: "assistant", text: "b" }] }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ messages: [{ role: "user", text: "   " }] }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ messages: [{ role: "system", text: "x" }] }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ messages: [{ role: "user", text: "x".repeat(CHAT_LIMITS.maxUserChars + 1) }] }).success).toBe(false);
    const many = Array.from({ length: CHAT_LIMITS.maxMessages + 1 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "x" }));
    expect(ChatRequestSchema.safeParse({ messages: many }).success).toBe(false);
    const huge = Array.from({ length: 21 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "x".repeat(i % 2 ? 10_000 : 3_900) }));
    expect(ChatRequestSchema.safeParse({ messages: huge }).success).toBe(false);
  });

  it("rate-limits turns per session with a refilling bucket", () => {
    resetChatLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < CHAT_BURST; i++) expect(consumeChatTurn("s1", t0).ok).toBe(true);
    const blocked = consumeChatTurn("s1", t0);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(consumeChatTurn("s2", t0).ok).toBe(true);
    expect(consumeChatTurn("s1", t0 + 60_000).ok).toBe(true);
  });

  it("NDJSON encode/decode round-trips and keeps partial lines", () => {
    const a = encodeEvent({ type: "text", delta: "he\nllo" });
    const b = encodeEvent({ type: "error", code: "aborted", message: "Stopped." });
    const { events, rest } = decodeEvents(a + b.slice(0, 10));
    expect(events).toEqual([{ type: "text", delta: "he\nllo" }]);
    expect(decodeEvents(rest + b.slice(10)).events[0]).toMatchObject({ type: "error" });
  });
});
