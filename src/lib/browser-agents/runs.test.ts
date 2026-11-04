import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";
import { SCRIPTED_LABEL, SCRIPTED_OFFLINE_LABEL } from "./recorder";
import { createTestDb } from "@/db/client";
import { activeRunId, AgentAlreadyRunningError, chooseMode, createRun, driveModeStepLabel, modelLabelFor, releaseRun } from "./runs";

const KEY = { ANTHROPIC_API_KEY: "test-key-not-real" };

describe("chooseMode", () => {
  it("is scripted offline even when an Anthropic key is present", () => {
    expect(chooseMode(parseEnv({ ...KEY, ESCHEAT_OFFLINE: "1" }))).toBe("scripted");
  });
  it("is stagehand online with a key", () => {
    expect(chooseMode(parseEnv({ ...KEY }))).toBe("stagehand");
  });
  it("is scripted online without a key", () => {
    expect(chooseMode(parseEnv({}))).toBe("scripted");
  });
});

describe("run labels", () => {
  const offline = parseEnv({ ...KEY, ESCHEAT_OFFLINE: "1" });
  const online = parseEnv({});
  it("labels offline scripted runs clearly", () => {
    expect(modelLabelFor("scripted", offline)).toBe("scripted (offline)");
    expect(driveModeStepLabel("scripted", undefined, offline)).toBe(SCRIPTED_OFFLINE_LABEL);
  });
  it("keeps the plain scripted label online", () => {
    expect(modelLabelFor("scripted", online)).toBe("scripted");
    expect(driveModeStepLabel("scripted", undefined, online)).toBe(SCRIPTED_LABEL);
  });
  it("names the Stagehand model when live", () => {
    expect(driveModeStepLabel("stagehand", "anthropic/claude-sonnet-5-5", online)).toContain("claude-sonnet-5-5");
  });
});

describe("run registry", () => {
  const args = { agent: "recovery_agent", subjectField: "companyId", subjectId: "co-1", mode: "scripted" as const, modelLabel: "scripted", input: {} };

  it("refuses a second run while one is registered, and allows one once it is released", async () => {
    const t = await createTestDb();
    const key = `test-recovery:${Math.random()}`;
    const first = await createRun(t.db, { ...args, key });
    await expect(createRun(t.db, { ...args, key })).rejects.toBeInstanceOf(AgentAlreadyRunningError);
    releaseRun(key, first);
    const second = await createRun(t.db, { ...args, key });
    expect(second).not.toBe(first);
    expect(activeRunId(key)).toBe(second);
    releaseRun(key, second);
  });

  it("a finished run's late release never frees the key a newer run holds", async () => {
    const t = await createTestDb();
    const key = `test-recovery:${Math.random()}`;
    const first = await createRun(t.db, { ...args, key });
    releaseRun(key, first); // released as soon as the row settled, before the slow browser teardown
    const second = await createRun(t.db, { ...args, key });
    releaseRun(key, first); // the first run's `finally`, after its teardown
    expect(activeRunId(key)).toBe(second);
    releaseRun(key, second);
    expect(activeRunId(key)).toBeUndefined();
  });
});
