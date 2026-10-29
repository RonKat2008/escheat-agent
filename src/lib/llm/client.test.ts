import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createTestDb, type TestDb } from "@/db/client";
import { agentRuns } from "@/db/schema";
import { AnthropicNotConfigured, StructuredOutputError, callStructured, setAnthropicClient } from "./client";
import { jsonMessage, message, mockClient } from "./testing";

const schema = z.object({ answer: z.string(), n: z.number().int() });
const base = {
  tier: "worker" as const,
  system: "sys",
  messages: [{ role: "user" as const, content: "hi" }],
  schema,
  toolName: "submit",
  agent: "test-agent",
};

beforeEach(() => {
  vi.stubEnv("ESCHEAT_OFFLINE", "");
  vi.stubEnv("ESCHEAT_RECORD", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});
afterEach(() => {
  setAnthropicClient(undefined);
  vi.unstubAllEnvs();
});

describe("callStructured", () => {
  it("parses a valid structured output and reports usage, cost and model", async () => {
    const client = mockClient([jsonMessage({ answer: "x", n: 3 })]);
    setAnthropicClient(client);
    const res = await callStructured(base);
    expect(res.data).toEqual({ answer: "x", n: 3 });
    expect(res.usage.inputTokens).toBe(100);
    expect(res.model).toBe("claude-haiku-5-5");
    expect(res.usage.costUsdMicros).toBe(100 * 0.1 + 50 * 0.5);
    const body = client.calls[0];
    expect(body?.tool_choice).toBeUndefined();
    expect((body?.output_config as { format: { type: string } }).format.type).toBe("json_schema");
  });

  it("retries once with the validation error fed back, then succeeds", async () => {
    const client = mockClient([jsonMessage({ answer: 5, n: "no" }), jsonMessage({ answer: "ok", n: 1 })]);
    setAnthropicClient(client);
    const res = await callStructured(base);
    expect(res.data.answer).toBe("ok");
    expect(client.calls).toHaveLength(2);
    expect(JSON.stringify(client.calls[1]?.messages.at(-1))).toContain("failed validation");
  });

  it("retries when the response is not JSON", async () => {
    const client = mockClient([message([{ type: "text", text: "sure thing" }]), jsonMessage({ answer: "x", n: 1 })]);
    setAnthropicClient(client);
    expect((await callStructured(base)).data.answer).toBe("x");
    expect(client.calls).toHaveLength(2);
  });

  it("throws StructuredOutputError after a second invalid output", async () => {
    setAnthropicClient(mockClient([jsonMessage({}), jsonMessage({})]));
    await expect(callStructured(base)).rejects.toBeInstanceOf(StructuredOutputError);
  });

  it("throws AnthropicNotConfigured with no key and no injected client", async () => {
    await expect(callStructured(base)).rejects.toBeInstanceOf(AnthropicNotConfigured);
  });

  it("with webSearch: research call (search tool, pause_turn resume) then a structuring call; citations collected", async () => {
    const client = mockClient([
      message(
        [
          { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "q" } },
          {
            type: "web_search_tool_result",
            tool_use_id: "s1",
            content: [{ type: "web_search_result", url: "https://sco.ca.gov/a", title: "A" }],
          },
        ],
        { stop_reason: "pause_turn", usage: { server_tool_use: { web_search_requests: 1 } } },
      ),
      message([
        {
          type: "text",
          text: "Three years.",
          citations: [{ type: "web_search_result_location", url: "https://sco.ca.gov/a", title: "A", cited_text: "three years" }],
        },
      ]),
      jsonMessage({ answer: "y", n: 2 }),
    ]);
    setAnthropicClient(client);
    const res = await callStructured({ ...base, tier: "orchestrator", webSearch: { maxUses: 3, allowedDomains: ["sco.ca.gov"] } });
    const webTool = client.calls[0]?.tools?.find((t) => "type" in t && t.type === "web_search_20260318");
    expect(webTool).toMatchObject({ max_uses: 3, allowed_domains: ["sco.ca.gov"], allowed_callers: ["direct"] });
    expect(client.calls[0]?.output_config).toBeUndefined();
    expect(client.calls[2]?.tools).toBeUndefined();
    expect(client.calls[2]?.output_config).toBeDefined();
    expect(JSON.stringify(client.calls[2]?.messages)).toContain("three years");
    expect(res.citations.some((c) => c.origin === "citation" && c.citedText === "three years")).toBe(true);
    expect(res.usage.webSearchRequests).toBe(1);
  });
});

describe("agent_runs logging", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("writes a succeeded row with model, tokens, cost and trace", async () => {
    setAnthropicClient(mockClient([jsonMessage({ answer: "x", n: 1 })]));
    const res = await callStructured({ ...base, db: t.db, subjectId: "item-1" });
    const [row] = await t.db.select().from(agentRuns).where(eq(agentRuns.id, res.runId));
    expect(row?.status).toBe("succeeded");
    expect(row?.agent).toBe("test-agent");
    expect(row?.model).toBe("claude-haiku-5-5");
    expect(row?.inputTokens).toBe(100);
    expect(row?.costUsdMicros).toBe(35);
    expect(row?.finishedAt).toBeTruthy();
    expect((row?.input as { subjectId: string }).subjectId).toBe("item-1");
    expect(Array.isArray(row?.trace)).toBe(true);
  });

  it("writes a failed row with the error", async () => {
    setAnthropicClient(mockClient([jsonMessage({}), jsonMessage({})]));
    await expect(callStructured({ ...base, db: t.db })).rejects.toThrow();
    const rows = await t.db.select().from(agentRuns);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("failed");
    expect(rows[0]?.error).toContain("StructuredOutputError");
  });
});
