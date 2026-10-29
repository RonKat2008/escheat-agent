import { mkdtempSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { cassettePath, canonicalize, requestHash, setCassetteDir } from "./cassette";
import { OfflineCassetteMissing, callStructured, setAnthropicClient } from "./client";
import { jsonMessage, mockClient } from "./testing";

let dir: string;
const opts = {
  tier: "worker" as const,
  system: "sys",
  messages: [{ role: "user" as const, content: "hi" }],
  schema: z.object({ v: z.number() }),
  toolName: "submit",
  agent: "cass-agent",
};

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "cassettes-"));
  setCassetteDir(dir);
  vi.stubEnv("ESCHEAT_OFFLINE", "");
  vi.stubEnv("ESCHEAT_RECORD", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});
afterEach(() => {
  setCassetteDir(undefined);
  setAnthropicClient(undefined);
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("cassette hashing", () => {
  it("is independent of key order", () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalize({ a: { c: 3, d: 2 }, b: 1 }));
    expect(requestHash({ model: "m", messages: [] })).toBe(requestHash({ messages: [], model: "m" }));
  });
  it("changes when the request changes", () => {
    expect(requestHash({ model: "m", messages: [] })).not.toBe(requestHash({ model: "n", messages: [] }));
  });
});

describe("record and replay", () => {
  it("records with ESCHEAT_RECORD=1 and replays offline without any client", async () => {
    vi.stubEnv("ESCHEAT_RECORD", "1");
    const client = mockClient([jsonMessage({ v: 7 })]);
    setAnthropicClient(client);
    const first = await callStructured(opts);
    expect(first.data.v).toBe(7);
    expect(existsSync(path.join(dir, "cass-agent"))).toBe(true);

    setAnthropicClient(undefined);
    vi.stubEnv("ESCHEAT_RECORD", "");
    vi.stubEnv("ESCHEAT_OFFLINE", "1");
    const replay = await callStructured(opts);
    expect(replay.data.v).toBe(7);
    expect(client.calls).toHaveLength(1);
  });

  it("offline with no cassette throws OfflineCassetteMissing and never calls a client", async () => {
    vi.stubEnv("ESCHEAT_OFFLINE", "1");
    const client = mockClient([jsonMessage({ v: 1 })]);
    setAnthropicClient(client);
    await expect(callStructured(opts)).rejects.toBeInstanceOf(OfflineCassetteMissing);
    expect(client.calls).toHaveLength(0);
  });

  it("does not write cassettes unless recording", async () => {
    setAnthropicClient(mockClient([jsonMessage({ v: 1 })]));
    await callStructured(opts);
    expect(existsSync(cassettePath("cass-agent", "x"))).toBe(false);
    expect(existsSync(path.join(dir, "cass-agent"))).toBe(false);
  });
});
