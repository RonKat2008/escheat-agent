import { describe, expect, it } from "vitest";
import { approverName, approverNameSchema, isValidApproverName } from "./approver";
import { approverLabel } from "./session";

describe("approver identity (R5-10)", () => {
  it.each(["", " ", "   ", "a", " a "])("rejects %j", (v) => {
    expect(isValidApproverName(v)).toBe(false);
  });
  it("accepts a real name and trims it", () => {
    expect(approverNameSchema.parse("  Dana Ortiz ")).toBe("Dana Ortiz");
  });
  it("rejects names over 80 characters", () => {
    expect(isValidApproverName("x".repeat(81))).toBe(false);
  });
  it("approverLabel refuses a blank name instead of recording 'unnamed reviewer'", () => {
    expect(() => approverLabel({ id: "abcdefgh1234", gateDisabled: true }, "  ")).toThrow(/approver/i);
  });
  it("approverLabel records the typed name with the session", () => {
    expect(approverLabel({ id: "abcdefgh1234", gateDisabled: false }, " Dana ")).toBe("Dana (passcode session abcdefgh)");
  });
});

describe("approver display (R6-10)", () => {
  it("records just the name when no sign-in is configured", () => {
    expect(approverLabel({ id: "dev", gateDisabled: true }, " Dogfood Controller ")).toBe("Dogfood Controller");
  });
  it.each([
    ["Dogfood Controller (local dev, gate disabled)", "Dogfood Controller"],
    ["Dana (passcode session abcdefgh)", "Dana"],
    ["Dana", "Dana"],
    ["", null],
    [null, null],
  ])("shows %j as %j", (stored, shown) => {
    expect(approverName(stored)).toBe(shown);
  });
});
