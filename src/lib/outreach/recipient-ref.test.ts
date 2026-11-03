import { describe, expect, it } from "vitest";
import { maskEmail, maskPhone, refForTyped } from "./recipient-mask";
import { recipientForClient, recipientOptions, recipientRef, resolveRecipient } from "./recipient-ref";
import { testEnv } from "./testing";

const env = testEnv({ ALLOWED_TEST_RECIPIENTS: "Ronit.Person@gmail.com,ops@example.com", ALLOWED_TEST_PHONES: "+1 (415) 555-0100" });

describe("recipient masking (R4-24)", () => {
  it("masks an email to its first letter and domain", () => {
    expect(maskEmail("ronit.person@gmail.com")).toBe("r•••@gmail.com");
    expect(maskEmail("x@y.io")).toBe("x•••@y.io");
    expect(maskEmail("not-an-email")).toBe("n•••");
  });

  it("masks a phone number down to the country code and last two digits", () => {
    expect(maskPhone("+14155550100")).toBe("+1 ••• ••• ••00");
    expect(maskPhone("4155550142")).toBe("••• ••• ••42");
  });

  it("the browser-facing allowlist never contains the full value", () => {
    const options = [...recipientOptions("email", env), ...recipientOptions("voice", env)];
    const json = JSON.stringify(options);
    expect(json).not.toMatch(/ronit\.person|ops@|5550100|555-0100/i);
    expect(options.map((o) => o.label)).toEqual(["r•••@gmail.com", "o•••@example.com", "+1 ••• ••• ••00"]);
    for (const o of options) expect(o.ref).toMatch(/^allow:[0-9a-f]{20}$/);
  });

  it("the server resolves a ref back to the allowlisted value and passes typed values through", () => {
    const [first] = recipientOptions("email", env);
    expect(resolveRecipient("email", first!.ref, env)).toBe("ronit.person@gmail.com");
    expect(resolveRecipient("voice", recipientOptions("voice", env)[0]!.ref, env)).toBe("+1 (415) 555-0100");
    expect(resolveRecipient("email", "someone@else.com", env)).toBe("someone@else.com");
    expect(resolveRecipient("email", "allow:0000000000000000000a", env)).toBe("allow:0000000000000000000a");
    expect(resolveRecipient("letter", "500 Market St", env)).toBe("500 Market St");
  });

  it("a stored recipient reaches the client as its ref plus a masked label", () => {
    expect(recipientForClient("email", "RONIT.PERSON@gmail.com", env)).toEqual({
      to: recipientRef("email", "ronit.person@gmail.com"),
      label: "R•••@gmail.com",
    });
    expect(recipientForClient("email", "stranger@example.org", env)).toEqual({ to: null, label: "s•••@example.org" });
    expect(recipientForClient("email", null, env)).toEqual({ to: null, label: null });
  });

  it("the browser computes the same ref for a typed address (case and phone formatting ignored)", async () => {
    expect(await refForTyped("email", " Ronit.Person@GMAIL.com ")).toBe(recipientRef("email", "ronit.person@gmail.com"));
    expect(await refForTyped("voice", "415-555-0100")).toBe(recipientRef("voice", "+1 (415) 555-0100"));
    expect(await refForTyped("email", "  ")).toBeNull();
  });
});
