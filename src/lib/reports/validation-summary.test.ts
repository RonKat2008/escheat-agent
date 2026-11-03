import { describe, expect, it } from "vitest";
import { renderValidatorWarning, summarizeValidation } from "./validation-summary";
import type { ValidationError } from "./validate";

const warn = (record: number, field: string): ValidationError => ({ record, field, message: "required-if-known field is blank", severity: "warning" });

describe("summarizeValidation", () => {
  it("counts a validator warning once even when the builder also lists it as text (R3-11)", () => {
    const structured = [warn(2, "OWNER-PHONE"), warn(3, "OWNER-PHONE")];
    const rendered = structured.map(renderValidatorWarning);
    expect(summarizeValidation(structured, rendered).warningCount).toBe(2);
    expect(summarizeValidation(structured).warningCount).toBe(2);
  });

  it("adds builder-only warnings and counts errors separately", () => {
    const v: ValidationError[] = [warn(2, "A"), { record: 0, field: "TOTAL", message: "mismatch", severity: "error" }];
    const s = summarizeValidation(v, [renderValidatorWarning(warn(2, "A")), "CA notice report written with HOLDER-RPT-TYPE A"]);
    expect(s).toEqual({ errorCount: 1, warningCount: 2 });
  });
});
