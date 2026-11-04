import { describe, expect, it } from "vitest";
import type { Env } from "@/lib/env";
import { emailRecipientReadiness } from "./draft";
import { assertAllowedEmail, RecipientNotAllowedError } from "./allowlist";

const env = (list?: string) => ({ ALLOWED_TEST_RECIPIENTS: list }) as unknown as Env;

describe("R9-12 email readiness agrees with approvability", () => {
  it("blocks when no recipient can ever pass the allowlist gate", () => {
    const r = emailRecipientReadiness("", env(undefined));
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatch(/no email address on file/);
    expect(() => assertAllowedEmail("", env(undefined))).toThrow(RecipientNotAllowedError);
  });

  it("is ready, with a plain warning, when an allowlist exists but no address is on file", () => {
    const r = emailRecipientReadiness(null, env("test@example.com"));
    expect(r.problems).toEqual([]);
    expect(r.warnings[0]).toMatch(/no email address on file/);
  });

  it("is silent when an address is already on the draft", () => {
    expect(emailRecipientReadiness("test@example.com", env("test@example.com"))).toEqual({ problems: [], warnings: [] });
  });

  it("the gate still refuses a blank recipient, with a message that says nothing was chosen", () => {
    expect(() => assertAllowedEmail("", env("test@example.com"))).toThrow(/no email recipient was chosen/);
    expect(() => assertAllowedEmail("x@y.com", env("test@example.com"))).toThrow(/is not on the test allowlist/);
  });
});
