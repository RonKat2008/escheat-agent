import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { setCassetteDir, writeCassette } from "@/lib/llm/cassette";
import { insertFixture, STANDARD_ITEMS } from "@/lib/queries/test-fixtures";
import { chatModel, CHAT_AGENT, CHAT_EFFORT, OFFLINE_DRIFT_MESSAGE, runChatTurn, toApiMessages } from "./agent";
import { CHAT_LIMITS, type ChatEvent } from "./protocol";
import { chatCassetteRequest, strictFingerprint } from "./replay-key";
import { CHAT_SYSTEM_PROMPT } from "./system-prompt";
import { anthropicToolDefinitions } from "./tools";

const msg = (content: unknown[], stop_reason: string) =>
  ({ id: "m", type: "message", role: "assistant", model: "x", content, stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as Anthropic.Message;

describe("offline replay: demo data drift", () => {
  let dir: string;
  let t: TestDb;
  let companyId: string;
  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "drift-"));
    setCassetteDir(dir);
    vi.stubEnv("ESCHEAT_OFFLINE", "1");
    vi.stubEnv("ESCHEAT_RECORD", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    t = await createTestDb();
    companyId = (await insertFixture(t.db, STANDARD_ITEMS)).companyId;
  });
  afterEach(async () => {
    setCassetteDir(undefined);
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    await t.close();
  });

  const firstBody = (): Anthropic.MessageCreateParamsNonStreaming => ({
    model: chatModel(),
    max_tokens: CHAT_LIMITS.maxTokens,
    system: [{ type: "text", text: CHAT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: anthropicToolDefinitions(),
    messages: toApiMessages([{ role: "user", text: "what day is it" }]),
    output_config: { effort: CHAT_EFFORT },
  });
  const run = async (): Promise<ChatEvent[]> => {
    const events: ChatEvent[] = [];
    await runChatTurn({ db: t.db, companyId, messages: [{ role: "user", text: "what day is it" }], emit: (e) => events.push(e) });
    return events;
  };

  it("shows one clean message and no tool card or partial text when the follow-up call was recorded against other data", async () => {
    const body = firstBody();
    writeCassette(CHAT_AGENT, chatCassetteRequest(body), msg([{ type: "text", text: "Let me check." }, { type: "tool_use", id: "toolu_1", name: "get_clock", input: {} }], "tool_use"), {
      fingerprint: strictFingerprint(body),
    });
    const events = await run();
    expect(events.find((e) => e.type === "error")).toMatchObject({ code: "offline_unavailable", message: OFFLINE_DRIFT_MESSAGE });
    expect(OFFLINE_DRIFT_MESSAGE).toMatch(/Demo data changed since these answers were recorded/);
    expect(OFFLINE_DRIFT_MESSAGE).not.toMatch(/pnpm/);
    expect(events.filter((e) => ["text", "tool_start", "tool_result"].includes(e.type))).toEqual([]);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("a prompt that was never recorded still reports 'no recorded answer', not drift", async () => {
    const events = await run();
    const err = events.find((e) => e.type === "error") as Extract<ChatEvent, { type: "error" }>;
    expect(err.message).toMatch(/no recorded answer/i);
    expect(err.message).not.toBe(OFFLINE_DRIFT_MESSAGE);
  });
});
