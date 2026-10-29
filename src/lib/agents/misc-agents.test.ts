import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicNotConfigured, setAnthropicClient } from "@/lib/llm/client";
import { jsonMessage, mockClient } from "@/lib/llm/testing";
import { draftLetterVariables } from "./letter-writer";
import { resolvePayeePair } from "./payee-resolver";
import { parseOwnerReply } from "./reply-parser";

const item = {
  kind: "check" as const,
  number: "10482",
  payee_name: "Bayline Electric",
  amount_cents: 234000,
  issue_date: "2025-08-01",
};

beforeEach(() => {
  vi.stubEnv("ESCHEAT_OFFLINE", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});
afterEach(() => {
  setAnthropicClient(undefined);
  vi.unstubAllEnvs();
});

describe("payee resolver", () => {
  it("returns a verdict from the worker model", async () => {
    setAnthropicClient(mockClient([jsonMessage({ same: true, confidence: 0.9, rationale: "Same address, Inc suffix." })]));
    const v = await resolvePayeePair({ a: { name: "Bayline Electric" }, b: { name: "Bayline Electric Inc" }, score: 0.88 });
    expect(v).toMatchObject({ same: true, confidence: 0.9 });
  });
  it("throws AnthropicNotConfigured without a key (caller decides)", async () => {
    await expect(resolvePayeePair({ a: { name: "A" }, b: { name: "B" }, score: 0.5 })).rejects.toBeInstanceOf(AnthropicNotConfigured);
  });
});

describe("letter writer", () => {
  const ok = {
    greeting: "Dear Bayline Electric,",
    itemDescription: "Check 10482 for $2,340.00 issued August 1, 2025.",
    responseInstructions: "Please reply to confirm your mailing address.",
  };
  it("returns variable parts", async () => {
    setAnthropicClient(mockClient([jsonMessage(ok)]));
    expect(await draftLetterVariables(item, { name: "Bayline Electric" }, { name: "Northwind" })).toEqual(ok);
  });
  it("rejects legal claims, retrying once with feedback", async () => {
    const client = mockClient([
      jsonMessage({ ...ok, responseInstructions: "The state will escheat this property by statute." }),
      jsonMessage(ok),
    ]);
    setAnthropicClient(client);
    const out = await draftLetterVariables(item, { name: "B" }, { name: "N" });
    expect(out).toEqual(ok);
    expect(JSON.stringify(client.calls[1]?.messages.at(-1))).toContain("legal claims");
  });
  it("enforces max lengths", async () => {
    setAnthropicClient(mockClient([jsonMessage({ ...ok, greeting: "x".repeat(500) }), jsonMessage({ ...ok, greeting: "x".repeat(500) })]));
    await expect(draftLetterVariables(item, { name: "B" }, { name: "N" })).rejects.toThrow(/validation/);
  });
});

describe("reply parser", () => {
  it("parses intent and address", async () => {
    setAnthropicClient(
      mockClient([jsonMessage({ intent: "confirm_address", newAddress: { line1: "5 Main St", city: "Austin", state: "TX", zip: "78701" }, confidence: 0.92 })]),
    );
    const r = await parseOwnerReply("Yes that's me, I moved to 5 Main St, Austin TX 78701");
    expect(r.intent).toBe("confirm_address");
    expect(r.newAddress?.zip).toBe("78701");
  });
  it("rejects an unknown intent after retry", async () => {
    setAnthropicClient(mockClient([jsonMessage({ intent: "wire_me_money", confidence: 1 }), jsonMessage({ intent: "nope", confidence: 1 })]));
    await expect(parseOwnerReply("x")).rejects.toThrow();
  });
});
