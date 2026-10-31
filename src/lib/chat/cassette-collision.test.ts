import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { cassettePath, requestHash, setCassetteDir, writeCassette } from "@/lib/llm/cassette";
import { CassetteCollision } from "@/lib/llm/errors";
import { insertFixture, STANDARD_ITEMS } from "@/lib/queries/test-fixtures";
import { chatModel, CHAT_AGENT, CHAT_EFFORT, runChatTurn, toApiMessages } from "./agent";
import { CHAT_LIMITS, type ChatEvent } from "./protocol";
import { chatCassetteRequest, strictFingerprint } from "./replay-key";
import { CHAT_SYSTEM_PROMPT } from "./system-prompt";
import { anthropicToolDefinitions } from "./tools";

const uuidA = "0a1b2c3d-1111-4222-8333-444455556666";
const uuidB = "ffffffff-aaaa-4bbb-8ccc-dddddddddddd";

const body = (messages: Anthropic.MessageParam[], over: Partial<Anthropic.MessageCreateParamsNonStreaming> = {}): Anthropic.MessageCreateParamsNonStreaming => ({
  model: "m1",
  max_tokens: 10,
  system: "sys",
  tools: [],
  messages,
  ...over,
});

const explain = (id: string, uuid: string, result = '{"amount":100}'): Anthropic.MessageParam[] => [
  { role: "user", content: "Explain it" },
  { role: "assistant", content: [{ type: "tool_use", id, name: "explain_item", input: { item: uuid } }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: result }] },
];

describe("cassette key collisions (L4)", () => {
  it("legacy key conflates requests that differ only in which row a result refers to; the strict fingerprint does not", () => {
    const a = body(explain("t1", uuidA, `{"row":"${uuidA}"}`));
    const b = body(explain("t1", uuidA, `{"row":"${uuidB}"}`));
    expect(requestHash(chatCassetteRequest(a))).toBe(requestHash(chatCassetteRequest(b)));
    expect(strictFingerprint(a)).not.toBe(strictFingerprint(b));
  });

  it("fingerprint is stable across tool_use ids, consistently renamed UUIDs and timestamps", () => {
    const a = body(explain("toolu_A", uuidA, `{"id":"${uuidA}","at":"2026-01-01T10:00:00Z"}`));
    const b = body(explain("toolu_B", uuidB, `{"id":"${uuidB}","at":"2030-05-05T01:02:03Z"}`));
    const renamed = body(explain("toolu_B", uuidB, `{"id":"${uuidB}","at":"2030-05-05T01:02:03Z"}`));
    expect(strictFingerprint(a)).toBe(strictFingerprint(renamed));
    expect(strictFingerprint(a)).toBe(strictFingerprint(b));
  });

  it("fingerprint tells apart a reused UUID from two distinct UUIDs", () => {
    const same = body(explain("t", uuidA, `{"a":"${uuidA}","b":"${uuidA}"}`));
    const different = body(explain("t", uuidA, `{"a":"${uuidA}","b":"${uuidB}"}`));
    expect(strictFingerprint(same)).not.toBe(strictFingerprint(different));
  });

  it("key covers model, system prompt, tools and messages", () => {
    const base = body([{ role: "user", content: "hi" }]);
    const key = (b: Anthropic.MessageCreateParamsNonStreaming) => requestHash(chatCassetteRequest(b));
    const fp = (b: Anthropic.MessageCreateParamsNonStreaming) => strictFingerprint(b);
    const variants = [
      body([{ role: "user", content: "hi" }], { model: "m2" }),
      body([{ role: "user", content: "hi" }], { system: "other" }),
      body([{ role: "user", content: "hi" }], { tools: [{ name: "x", description: "", input_schema: { type: "object" } }] }),
      body([{ role: "user", content: "hi!" }]),
    ];
    for (const v of variants) {
      expect(key(v)).not.toBe(key(base));
      expect(fp(v)).not.toBe(fp(base));
    }
  });
});

describe("cassette store fails loudly on collisions", () => {
  let dir: string;
  const response = { id: "msg", content: [], stop_reason: "end_turn" } as unknown as Anthropic.Message;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "cassette-"));
    setCassetteDir(dir);
  });
  afterEach(() => {
    setCassetteDir(undefined);
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to overwrite a cassette recorded for a different strict request", () => {
    const req = chatCassetteRequest(body(explain("t", uuidA)));
    writeCassette("chat", req, response, { fingerprint: "fp-one" });
    const file = cassettePath("chat", requestHash(req));
    const before = readFileSync(file, "utf8");
    expect(() => writeCassette("chat", req, response, { fingerprint: "fp-two" })).toThrow(CassetteCollision);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("still allows re-recording the same request", () => {
    const req = chatCassetteRequest(body(explain("t", uuidA)));
    writeCassette("chat", req, response, { fingerprint: "fp-one" });
    expect(() => writeCassette("chat", req, response, { fingerprint: "fp-one" })).not.toThrow();
  });

  describe("offline replay", () => {
    let t: TestDb;
    let companyId: string;
    beforeEach(async () => {
      vi.stubEnv("ESCHEAT_OFFLINE", "1");
      vi.stubEnv("ESCHEAT_RECORD", "");
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      t = await createTestDb();
      companyId = (await insertFixture(t.db, STANDARD_ITEMS)).companyId;
    });
    afterEach(async () => {
      vi.unstubAllEnvs();
      await t.close();
    });

    const run = async (): Promise<ChatEvent[]> => {
      const events: ChatEvent[] = [];
      await runChatTurn({ db: t.db, companyId, messages: [{ role: "user", text: "hello there" }], emit: (e) => events.push(e) });
      return events;
    };
    const turnBody = (): Anthropic.MessageCreateParamsNonStreaming => ({
      model: chatModel(),
      max_tokens: CHAT_LIMITS.maxTokens,
      system: [{ type: "text", text: CHAT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: anthropicToolDefinitions(),
      messages: toApiMessages([{ role: "user", text: "hello there" }]),
      output_config: { effort: CHAT_EFFORT },
    });
    const reply = { id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: "WRONG ANSWER" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } as unknown as Anthropic.Message;

    it("reports an error and replays nothing when the stored fingerprint does not match the request", async () => {
      writeCassette(CHAT_AGENT, chatCassetteRequest(turnBody()), reply, { fingerprint: "someone-elses-request" });
      const events = await run();
      expect(events.find((e) => e.type === "error")).toMatchObject({ code: "offline_unavailable", message: expect.stringMatching(/does not match/i) });
      expect(events.some((e) => e.type === "text")).toBe(false);
    });

    it("reports an error when the cassette file content does not match its key", async () => {
      const req = chatCassetteRequest(turnBody());
      const file = writeCassette(CHAT_AGENT, req, reply, { fingerprint: strictFingerprint(turnBody()) });
      const doc = JSON.parse(readFileSync(file, "utf8"));
      doc.request.messages = [{ role: "user", content: "a different question" }];
      writeFileSync(file, JSON.stringify(doc));
      const events = await run();
      expect(events.find((e) => e.type === "error")).toMatchObject({ code: "offline_unavailable" });
      expect(events.some((e) => e.type === "text")).toBe(false);
    });

    it("replays a cassette whose fingerprint matches, and a legacy one with no fingerprint", async () => {
      const req = chatCassetteRequest(turnBody());
      writeCassette(CHAT_AGENT, req, reply, { fingerprint: strictFingerprint(turnBody()) });
      expect((await run()).some((e) => e.type === "text")).toBe(true);
      writeCassette(CHAT_AGENT, req, reply);
      expect((await run()).some((e) => e.type === "text")).toBe(true);
    });

    it("reports 'no recorded answer' for a missing cassette", async () => {
      expect((await run()).find((e) => e.type === "error")).toMatchObject({ code: "offline_unavailable" });
    });
  });
});
