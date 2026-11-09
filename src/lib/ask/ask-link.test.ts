import { describe, expect, it } from "vitest";
import { CHAT_LIMITS } from "@/lib/chat/protocol";
import { askHref, askLinkFor } from "./ask-link";
import { APPROVALS_PROMPT, DEADLINES_PROMPT, EXPOSURE_PROMPT } from "./starters";

describe("askHref", () => {
  it("encodes the prompt as the q param", () => {
    expect(askHref("What's due in the next 90 days?")).toBe("/ask?q=What's%20due%20in%20the%20next%2090%20days%3F");
    expect(new URL(askHref("a & b #1 / c?"), "http://x").searchParams.get("q")).toBe("a & b #1 / c?");
  });

  it("trims and caps the prompt at the chat's user-message limit", () => {
    const long = `  ${"x".repeat(CHAT_LIMITS.maxUserChars + 50)}  `;
    const q = new URL(askHref(long), "http://x").searchParams.get("q")!;
    expect(q).toHaveLength(CHAT_LIMITS.maxUserChars);
    expect(q.startsWith("x")).toBe(true);
  });
});

describe("askLinkFor", () => {
  it("links prompts Ask answers today, live or replaying", () => {
    for (const a of ["ready", "offline"] as const) {
      expect(askLinkFor(EXPOSURE_PROMPT, a)).toBe(askHref(EXPOSURE_PROMPT));
      expect(askLinkFor(DEADLINES_PROMPT, a)).toBe(askHref(DEADLINES_PROMPT));
    }
  });

  it("never links a prompt that would reply 'no recorded answer'", () => {
    expect(askLinkFor("Approve the CA report", "offline")).toBeNull();
    expect(askLinkFor("Approve the CA report", "ready")).toBeNull();
  });

  it("links the approval cards (slice 4) in every availability: they need no model", () => {
    for (const a of ["ready", "offline", "not_configured"] as const) {
      expect(askLinkFor(APPROVALS_PROMPT, a)).toBe(askHref(APPROVALS_PROMPT));
      expect(askLinkFor("Close October 2026", a)).toBe(askHref("Close October 2026"));
    }
  });

  it("links the Ask action cards in every availability: they need no model", () => {
    for (const a of ["ready", "offline", "not_configured"] as const) {
      expect(askLinkFor("What's overdue?", a)).toBe(askHref("What's overdue?"));
      expect(askLinkFor("Upload a ledger CSV", a)).toBe(askHref("Upload a ledger CSV"));
    }
  });

  it("without a model, links only card prompts (free questions cannot be answered)", () => {
    expect(askLinkFor(EXPOSURE_PROMPT, "not_configured")).toBeNull();
    expect(askLinkFor("Get started", "not_configured")).toBe("/ask?q=Get%20started");
  });
});
