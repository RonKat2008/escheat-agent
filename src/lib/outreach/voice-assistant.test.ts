import { describe, expect, it } from "vitest";
import { assistantSafetyProblems } from "./voice";

const safe = () => ({
  id: "asst_1",
  name: "Escheat call",
  firstMessage: "Hello",
  model: { provider: "anthropic", model: "claude-haiku-5-5", messages: [{ role: "system", content: "x" }], maxTokens: 250 },
  voice: { provider: "vapi", voiceId: "Clara" },
  maxDurationSeconds: 180,
});

describe("assistantSafetyProblems (allowlist, fails closed)", () => {
  it("passes a minimal safe assistant", () => {
    expect(assistantSafetyProblems(safe())).toEqual([]);
    expect(assistantSafetyProblems({ ...safe(), model: { ...safe().model, tools: [], toolIds: [] } })).toEqual([]);
  });

  it.each([
    ["model.tools", { model: { ...safe().model, tools: [{ type: "endCall" }] } }, "model.tools"],
    ["model.toolIds", { model: { ...safe().model, toolIds: ["t1"] } }, "model.toolIds"],
    ["model.toolRefs", { model: { ...safe().model, toolRefs: [{ id: "t1" }] } }, "model.toolRefs"],
    ["hooks", { hooks: [{ on: "call.ending", do: [] }] }, "hooks"],
    ["server", { server: { url: "https://evil.example" } }, "server"],
    ["serverUrl", { serverUrl: "https://evil.example" }, "serverUrl"],
    ["server.url", { server: { url: "https://evil.example" } }, "server.url"],
    ["forwardingPhoneNumber", { forwardingPhoneNumber: "+14155559999" }, "forwardingPhoneNumber"],
    ["model.forwardingPhoneNumber", { model: { ...safe().model, forwardingPhoneNumber: "+14155559999" } }, "model.forwardingPhoneNumber"],
    ["transferPlan", { transferPlan: { mode: "blind-transfer" } }, "transferPlan"],
    ["an unknown top-level key", { mysteryFeature: true }, "mysteryFeature"],
    ["an unknown model key", { model: { ...safe().model, knowledgeBase: {} } }, "model.knowledgeBase"],
    ["monitorPlan", { monitorPlan: { controlEnabled: true } }, "monitorPlan"],
  ])("refuses %s and names the offending key", (_n, extra, key) => {
    const problems = assistantSafetyProblems({ ...safe(), ...extra });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(" | ")).toContain(key);
  });

  it("refuses an empty or unreadable config", () => {
    expect(assistantSafetyProblems(null)).toHaveLength(1);
    expect(assistantSafetyProblems([])).toHaveLength(1);
    expect(assistantSafetyProblems("x")).toHaveLength(1);
  });

  it("refuses a non-object model", () => {
    expect(assistantSafetyProblems({ ...safe(), model: "gpt" }).join(" ")).toContain("model");
  });
});
