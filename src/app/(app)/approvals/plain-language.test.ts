import { describe, expect, it } from "vitest";
import { plainBlockedReason, plainLanguage } from "./plain-language";

const CONFIG = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|variables_source|rule TODO/;

describe("plainLanguage (R3-14)", () => {
  it.each([
    "OWNER_LINK_SECRET is not set; the owner link is signed with a temporary dev secret and stops working when the dev server restarts",
    "APP_BASE_URL is not set; the owner link uses the address this app is being served from",
    "required notice language for TX is UNKNOWN (rule TODO); letter is not ready",
    "required state notice language is UNKNOWN for this state (rule TODO); letter is not ready",
    "TX required-language rule value is UNVERIFIED",
    "letter has no composed body (run draft first)",
    "Set ALLOWED_TEST_RECIPIENTS to continue",
  ])("never shows config text: %s", (msg) => {
    const out = plainLanguage(msg);
    expect(out).not.toMatch(CONFIG);
    expect(out.length).toBeGreaterThan(0);
  });

  it("uses operator-copy wording for allowlist settings", () => {
    expect(plainLanguage("Set ALLOWED_TEST_RECIPIENTS to continue")).toBe("Email sending is limited to test addresses. Add one in Settings → Connections.");
  });

  it("R8-04: a missing owner-link secret says not configured and names the setting to fix", () => {
    const out = plainLanguage("owner response link unavailable: OWNER_LINK_SECRET is missing or shorter than 16 characters.");
    expect(out).toBe("The owner reply link is not configured. Owner reply links need OWNER_LINK_SECRET; set it in .env.local.");
    expect(out).not.toMatch(/https?:\/\//);
  });

  it("drops a message that was only developer residue", () => {
    expect(plainLanguage("variables_source: model")).toBe("");
  });

  it("names the state for unknown notice wording", () => {
    expect(plainLanguage("required notice language for TX is UNKNOWN (rule TODO); letter is not ready")).toBe(
      "The TX notice wording has not been confirmed yet, so this letter can't be approved.",
    );
  });

  it("turns an unknown message into a sentence without inventing content", () => {
    expect(plainLanguage("holder is on vacation")).toBe("Holder is on vacation.");
  });

  it("keeps the Blocked lead and de-duplicates parts", () => {
    expect(plainBlockedReason("Blocked: owner mailing address is missing or incomplete; owner mailing address is missing or incomplete")).toBe(
      "Blocked: The owner's mailing address is missing or incomplete.",
    );
    expect(plainBlockedReason("Blocked: required notice language for CA is UNKNOWN (rule TODO); letter is not ready")).toMatch(
      /^Blocked: The CA notice wording .* Letter is not ready\.$/,
    );
  });
});
