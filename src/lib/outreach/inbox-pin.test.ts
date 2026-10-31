import { describe, expect, it } from "vitest";
import type { Outreach } from "@/db/schema";
import { buildEmailPayload } from "./payloads";
import { testEnv } from "./testing";

const row = { id: "o1", body: "<p>body</p>", subject: "subject" } as unknown as Outreach;
const build = (env: ReturnType<typeof testEnv>) => buildEmailPayload(row, "owner@example.com", env);

describe("L7: sending inbox is pinned to the dedicated username", () => {
  it("allows the dedicated escheat-agent local part on any domain, case-insensitively", () => {
    expect(build(testEnv({ AGENTMAIL_INBOX_ID: "escheat-agent@agentmail.to" })).from).toBe("escheat-agent@agentmail.to");
    expect(() => build(testEnv({ AGENTMAIL_INBOX_ID: "Escheat-Agent@agentmail.to" }))).not.toThrow();
  });

  it("refuses a foreign inbox and names the override variable", () => {
    expect(() => build(testEnv({ AGENTMAIL_INBOX_ID: "someone-else@agentmail.to" }))).toThrow(/AGENTMAIL_ALLOWED_INBOX/);
  });

  it("rejects look-alike local parts and a bare username with no address", () => {
    for (const inbox of [
      "escheat-agent2@agentmail.to",
      "evil-escheat-agent@agentmail.to",
      "escheat-agent.evil@agentmail.to",
      "x@escheat-agent.com",
      "escheat-agent",
    ]) {
      expect(() => build(testEnv({ AGENTMAIL_INBOX_ID: inbox })), inbox).toThrow(/not the dedicated/);
    }
  });

  it("AGENTMAIL_ALLOWED_INBOX permits exactly that address and nothing else", () => {
    const env = (inbox: string) => testEnv({ AGENTMAIL_INBOX_ID: inbox, AGENTMAIL_ALLOWED_INBOX: "me@agentmail.to" });
    expect(() => build(env("me@agentmail.to"))).not.toThrow();
    expect(() => build(env("ME@agentmail.to"))).not.toThrow();
    expect(() => build(env("other@agentmail.to"))).toThrow(/not the dedicated/);
    expect(() => build(env("me@other.com"))).toThrow(/not the dedicated/);
  });

  it("an unset inbox is still 'not configured', not a pinning error", () => {
    expect(() => build(testEnv({ AGENTMAIL_INBOX_ID: "" }))).toThrow(/not configured/);
  });
});
