import { describe, expect, it } from "vitest";
import { approverNameSchema, isValidApproverName } from "./approver";
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
