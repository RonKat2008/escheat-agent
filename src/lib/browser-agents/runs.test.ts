import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";
import { SCRIPTED_LABEL, SCRIPTED_OFFLINE_LABEL } from "./recorder";
import { chooseMode, driveModeStepLabel, modelLabelFor } from "./runs";

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
