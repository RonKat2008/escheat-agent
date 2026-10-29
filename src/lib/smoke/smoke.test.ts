import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { parseEnv } from "@/lib/env";
import { buildChecks, type SmokeDeps } from "./checks";
import {
  ArgError,
  exitCodeFor,
  formatTable,
  parseArgs,
  runChecks,
  SkipCheck,
  toJson,
  type ServiceCheck,
  type SmokeArgs,
  type SmokeContext,
} from "./run";

const FAKE_DB = {} as Db;

function ctxFor(raw: Record<string, string>, args: Partial<SmokeArgs> = {}): SmokeContext & { getDb: ReturnType<typeof vi.fn> } {
  const getDb = vi.fn(async () => FAKE_DB);
  return {
    env: parseEnv(raw),
    raw,
    args: { dial: false, ...args },
    getDb,
    fetch: vi.fn(async () => {
      throw new Error("network disabled in tests");
    }) as unknown as typeof fetch,
  };
}

const sendResult = (over: Record<string, unknown> = {}) => ({
  outreachId: "o1",
  channel: "letter" as const,
  status: "sent",
  sent: true,
  offline: false,
  providerId: "prov_1",
  previewUrl: null,
  ...over,
});

function fakeDeps(over: Partial<SmokeDeps> = {}): SmokeDeps & { approveOutreach: ReturnType<typeof vi.fn>; sendOutreach: ReturnType<typeof vi.fn>; seedOutreach: ReturnType<typeof vi.fn> } {
  return {
    callStructured: vi.fn(),
    seedOutreach: vi.fn(async () => "o1"),
    approveOutreach: vi.fn(async () => ({ approvalId: "a1", outreachId: "o1", status: "approved", payloadSha256: "x" })),
    sendOutreach: vi.fn(async () => sendResult()),
    runRecovery: vi.fn(),
    seedCompany: vi.fn(),
    loadAgentRun: vi.fn(),
    getAgent: vi.fn(async () => ({ name: "Test Agent", raw: { conversationConfig: { agent: { prompt: { builtInTools: {}, tools: [] } } } } })),
    createLinkToken: vi.fn(async () => "link-sandbox-0000-1111"),
    createSandboxPublicToken: vi.fn(async () => "public-sandbox-0000-1111"),
    qboProbe: vi.fn(async () => ({ purchaseCount: 3, rotated: false })),
    ...over,
  } as never;
}

const one = async (service: string, deps: SmokeDeps, ctx: SmokeContext) => {
  const [r] = await runChecks(buildChecks(deps).filter((c) => c.service === service), ctx);
  return r!;
};

const stub = (service: string, outcome: "pass" | "fail" | "skipcheck" | "skipreason"): ServiceCheck => ({
  service,
  skipReason: () => (outcome === "skipreason" ? "not configured: missing X" : undefined),
  run: async () => {
    if (outcome === "fail") throw new Error("boom");
    if (outcome === "skipcheck") throw new SkipCheck("replica down");
    return "ok";
  },
});

describe("skip detection", () => {
  it("every service is SKIPPED, naming the missing env vars, when nothing is configured", async () => {
    const results = await runChecks(buildChecks(fakeDeps()), ctxFor({ DEMO_ANCHOR_DATE: "2026-11-01" }));
    const by = Object.fromEntries(results.map((r) => [r.service, r]));
    expect(results.map((r) => r.status)).toEqual(Array(8).fill("SKIPPED"));
    expect(by.Anthropic!.detail).toContain("ANTHROPIC_API_KEY");
    expect(by.Resend!.detail).toContain("RESEND_API_KEY, RESEND_FROM, ALLOWED_TEST_RECIPIENTS");
    expect(by.ElevenLabs!.detail).toContain("ELEVENLABS_AGENT_ID");
    expect(by.Plaid!.detail).toContain("PLAID_SECRET");
    expect(exitCodeFor(results)).toBe(0);
  });

  it("treats empty-string env values as missing", async () => {
    const r = await one("Lob", fakeDeps(), ctxFor({ LOB_TEST_API_KEY: "  " }));
    expect(r.status).toBe("SKIPPED");
  });

  it("ESCHEAT_OFFLINE=1 skips the model and send checks instead of faking a pass", async () => {
    const deps = fakeDeps();
    const ctx = ctxFor({ ANTHROPIC_API_KEY: "sk-ant-0000000000", LOB_TEST_API_KEY: "test_abc", ESCHEAT_OFFLINE: "1" });
    expect((await one("Anthropic", deps, ctx)).status).toBe("SKIPPED");
    expect((await one("Lob", deps, ctx)).status).toBe("SKIPPED");
    expect(deps.callStructured).not.toHaveBeenCalled();
    expect(deps.sendOutreach).not.toHaveBeenCalled();
  });

  it("Stagehand is SKIPPED (not FAIL) when the local replica is unreachable", async () => {
    const r = await one("Stagehand", fakeDeps(), ctxFor({ ANTHROPIC_API_KEY: "sk-ant-0000000000" }));
    expect(r.status).toBe("SKIPPED");
    expect(r.detail).toContain("not reachable");
  });
});

describe("aggregation and exit code", () => {
  it("any configured FAIL gives exit code 1; PASS + SKIPPED alone gives 0", async () => {
    const ctx = ctxFor({});
    const ok = await runChecks([stub("a", "pass"), stub("b", "skipreason"), stub("c", "skipcheck")], ctx);
    expect(ok.map((r) => r.status)).toEqual(["PASS", "SKIPPED", "SKIPPED"]);
    expect(exitCodeFor(ok)).toBe(0);
    const bad = await runChecks([stub("a", "pass"), stub("b", "fail"), stub("c", "skipreason")], ctx);
    expect(bad.map((r) => r.status)).toEqual(["PASS", "FAIL", "SKIPPED"]);
    expect(bad[1]!.detail).toContain("boom");
    expect(exitCodeFor(bad)).toBe(1);
  });

  it("one failing check does not stop the others", async () => {
    const results = await runChecks([stub("a", "fail"), stub("b", "pass")], ctxFor({}));
    expect(results.map((r) => r.status)).toEqual(["FAIL", "PASS"]);
  });

  it("redacts secret env values from failure details", async () => {
    const leaky: ServiceCheck = { service: "x", skipReason: () => undefined, run: async () => { throw new Error("401 for key sk-ant-SECRETVALUE123"); } };
    const [r] = await runChecks([leaky], ctxFor({ ANTHROPIC_API_KEY: "sk-ant-SECRETVALUE123" }));
    expect(r!.detail).not.toContain("SECRETVALUE123");
    expect(r!.detail).toContain("[redacted]");
  });

  it("--only filters services case-insensitively", async () => {
    const results = await runChecks([stub("Lob", "pass"), stub("Plaid", "pass")], ctxFor({}, { only: ["lob"] }));
    expect(results.map((r) => r.service)).toEqual(["Lob"]);
  });

  it("formats a table and JSON", async () => {
    const results = await runChecks([stub("a", "pass"), stub("b", "fail")], ctxFor({}));
    const table = formatTable(results);
    expect(table).toMatch(/service\s+status\s+detail/);
    expect(table).toContain("1 passed, 1 failed, 0 skipped");
    const json = JSON.parse(toJson(results, new Date("2026-11-01T00:00:00Z")));
    expect(json.ok).toBe(false);
    expect(json.results).toHaveLength(2);
  });
});

describe("Anthropic", () => {
  it("records model and token usage from the existing structured client", async () => {
    const deps = fakeDeps({
      callStructured: vi.fn(async () => ({
        data: { property_type: "vendor_check", confidence: 0.97 },
        citations: [],
        usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 0, cacheCreationTokens: 0, webSearchRequests: 0, costUsdMicros: 270 },
        model: "claude-haiku-5-5",
        runId: "r1",
      })) as never,
    });
    const r = await one("Anthropic", deps, ctxFor({ ANTHROPIC_API_KEY: "sk-ant-0000000000" }));
    expect(r.status).toBe("PASS");
    expect(r.detail).toContain("model=claude-haiku-5-5");
    expect(r.detail).toContain("in=120 out=30");
  });
});

describe("Lob", () => {
  it("refuses a non-test key: FAIL, no database, no approval, no send", async () => {
    const deps = fakeDeps();
    const ctx = ctxFor({ LOB_TEST_API_KEY: "live_0123456789abcdef" });
    const r = await one("Lob", deps, ctx);
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("test_");
    expect(ctx.getDb).not.toHaveBeenCalled();
    expect(deps.seedOutreach).not.toHaveBeenCalled();
    expect(deps.approveOutreach).not.toHaveBeenCalled();
    expect(deps.sendOutreach).not.toHaveBeenCalled();
  });

  it("with a test_ key: approves then sends through the real send path and reports the Lob id", async () => {
    const deps = fakeDeps({ sendOutreach: vi.fn(async () => sendResult({ providerId: "ltr_abc" })) as never });
    const r = await one("Lob", deps, ctxFor({ LOB_TEST_API_KEY: "test_0123456789abcdef" }));
    expect(r.status).toBe("PASS");
    expect(r.detail).toContain("ltr_abc");
    expect(deps.seedOutreach).toHaveBeenCalledWith(FAKE_DB, "letter", expect.objectContaining({ body: expect.stringContaining("SYNTHETIC") }));
    expect(deps.approveOutreach.mock.invocationCallOrder[0]).toBeLessThan(deps.sendOutreach.mock.invocationCallOrder[0]!);
  });

  it("FAILs when the send path reports nothing was sent", async () => {
    const deps = fakeDeps({ sendOutreach: vi.fn(async () => sendResult({ sent: false, providerId: null })) as never });
    const r = await one("Lob", deps, ctxFor({ LOB_TEST_API_KEY: "test_0123456789abcdef" }));
    expect(r.status).toBe("FAIL");
  });
});

describe("Resend", () => {
  const base = { RESEND_API_KEY: "re_0123456789", RESEND_FROM: "Escheat <onboarding@resend.dev>" };

  it("sends only to the FIRST address in ALLOWED_TEST_RECIPIENTS", async () => {
    const deps = fakeDeps({ sendOutreach: vi.fn(async () => sendResult({ channel: "email", providerId: "re_id1" })) as never });
    const r = await one("Resend", deps, ctxFor({ ...base, ALLOWED_TEST_RECIPIENTS: "Owner@Example.com, delivered@resend.dev" }));
    expect(r.status).toBe("PASS");
    expect(r.detail).toContain("owner@example.com");
    expect(deps.sendOutreach).toHaveBeenCalledTimes(1);
    expect(deps.sendOutreach).toHaveBeenCalledWith(FAKE_DB, "o1", expect.objectContaining({ to: "owner@example.com" }));
    expect(deps.approveOutreach).toHaveBeenCalledWith(FAKE_DB, "o1", "smoke-live", expect.objectContaining({ to: "owner@example.com" }));
  });

  it("is SKIPPED without an allowlist (never invents a recipient)", async () => {
    const deps = fakeDeps();
    const r = await one("Resend", deps, ctxFor(base));
    expect(r.status).toBe("SKIPPED");
    expect(r.detail).toContain("ALLOWED_TEST_RECIPIENTS");
    expect(deps.sendOutreach).not.toHaveBeenCalled();
  });
});

describe("ElevenLabs", () => {
  const base = { ELEVENLABS_API_KEY: "xi-0123456789", ELEVENLABS_AGENT_ID: "agent_1" };

  it("by default only reads the agent config: no seed, no approval, no dial", async () => {
    const deps = fakeDeps();
    const r = await one("ElevenLabs", deps, ctxFor({ ...base, ELEVENLABS_PHONE_NUMBER_ID: "ph_1", ALLOWED_TEST_PHONES: "+14155550100" }));
    expect(r.status).toBe("PASS");
    expect(r.detail).toContain("no call placed");
    expect(deps.getAgent).toHaveBeenCalledWith("xi-0123456789", "agent_1");
    expect(deps.seedOutreach).not.toHaveBeenCalled();
    expect(deps.approveOutreach).not.toHaveBeenCalled();
    expect(deps.sendOutreach).not.toHaveBeenCalled();
  });

  it("FAILs (and never dials, even with --dial) when a transfer tool is enabled", async () => {
    const deps = fakeDeps({
      getAgent: vi.fn(async () => ({ raw: { conversationConfig: { agent: { prompt: { builtInTools: { transferToNumber: {} } } } } } })) as never,
    });
    const r = await one("ElevenLabs", deps, ctxFor({ ...base, ELEVENLABS_PHONE_NUMBER_ID: "ph_1", ALLOWED_TEST_PHONES: "+14155550100" }, { dial: true }));
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("transfer_to_number");
    expect(deps.sendOutreach).not.toHaveBeenCalled();
  });

  it("--dial to a number that is not allowlisted is refused before anything is created", async () => {
    const deps = fakeDeps();
    const raw = { ...base, ELEVENLABS_PHONE_NUMBER_ID: "ph_1", ALLOWED_TEST_PHONES: "+14155550100" };
    const r = await one("ElevenLabs", deps, ctxFor(raw, { dial: true, dialTo: "+14155559999" }));
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("not on the test allowlist");
    expect(deps.seedOutreach).not.toHaveBeenCalled();
    expect(deps.sendOutreach).not.toHaveBeenCalled();
  });

  it("--dial needs ELEVENLABS_PHONE_NUMBER_ID and ALLOWED_TEST_PHONES", async () => {
    const deps = fakeDeps();
    const r = await one("ElevenLabs", deps, ctxFor(base, { dial: true }));
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("ELEVENLABS_PHONE_NUMBER_ID, ALLOWED_TEST_PHONES");
    expect(deps.sendOutreach).not.toHaveBeenCalled();
  });

  it("--dial calls the first allowlisted number through the approved send path", async () => {
    const deps = fakeDeps({ sendOutreach: vi.fn(async () => sendResult({ channel: "voice", providerId: "conv_1" })) as never });
    const raw = { ...base, ELEVENLABS_PHONE_NUMBER_ID: "ph_1", ALLOWED_TEST_PHONES: "+14155550100, +14155550101" };
    const r = await one("ElevenLabs", deps, ctxFor(raw, { dial: true }));
    expect(r.status).toBe("PASS");
    expect(r.detail).toContain("+14155550100");
    expect(deps.sendOutreach).toHaveBeenCalledWith(FAKE_DB, "o1", expect.objectContaining({ to: "+14155550100" }));
  });
});

describe("QuickBooks, Plaid, Inngest", () => {
  it("Plaid calls the sandbox link-token and public-token endpoints and masks the tokens", async () => {
    const deps = fakeDeps();
    const r = await one("Plaid", deps, ctxFor({ PLAID_CLIENT_ID: "cid", PLAID_SECRET: "secret-0123456789" }));
    expect(r.status).toBe("PASS");
    expect(deps.createLinkToken).toHaveBeenCalled();
    expect(r.detail).not.toContain("0000-1111");
  });

  it("Plaid refuses a non-sandbox PLAID_ENV", async () => {
    const r = await one("Plaid", fakeDeps(), ctxFor({ PLAID_CLIENT_ID: "cid", PLAID_SECRET: "secret-0123456789", PLAID_ENV: "production" }));
    expect(r.status).toBe("FAIL");
  });

  it("QuickBooks is SKIPPED with an honest reason when only app credentials are present", async () => {
    const deps = fakeDeps();
    const r = await one("QuickBooks", deps, ctxFor({ QBO_CLIENT_ID: "a", QBO_CLIENT_SECRET: "b", QBO_REDIRECT_URI: "http://localhost/cb" }));
    expect(r.status).toBe("SKIPPED");
    expect(r.detail).toContain("QBO_SMOKE_REFRESH_TOKEN");
    expect(deps.qboProbe).not.toHaveBeenCalled();
  });

  it("Inngest: both keys PASS (presence only); one key FAILs; none and no dev server SKIPPED", async () => {
    const deps = fakeDeps();
    expect((await one("Inngest", deps, ctxFor({ INNGEST_EVENT_KEY: "e", INNGEST_SIGNING_KEY: "signkey-test-0123" }))).status).toBe("PASS");
    expect((await one("Inngest", deps, ctxFor({ INNGEST_EVENT_KEY: "e" }))).status).toBe("FAIL");
    expect((await one("Inngest", deps, ctxFor({}))).status).toBe("SKIPPED");
  });
});

describe("parseArgs", () => {
  it("defaults to no dial", () => {
    expect(parseArgs([])).toEqual({ dial: false });
  });
  it("parses flags in both spaced and = forms", () => {
    expect(parseArgs(["--dial", "--dial-to=+14155550100", "--json", "out.json", "--only", "lob,resend"])).toEqual({
      dial: true,
      dialTo: "+14155550100",
      json: "out.json",
      only: ["lob", "resend"],
    });
  });
  it("rejects unknown flags, missing values, and --dial-to without --dial", () => {
    expect(() => parseArgs(["--nope"])).toThrow(ArgError);
    expect(() => parseArgs(["--json"])).toThrow(ArgError);
    expect(() => parseArgs(["--dial-to", "+1415"])).toThrow(ArgError);
  });
});
