import { describe, expect, it } from "vitest";
import { suggestMapping } from "@/lib/ingest/mapping";
import { duplicateHeaders, interpretIngestResponse, missingRequired, setColumn } from "./csv-upload";

describe("csv upload mapping helpers", () => {
  const headers = ["Check #", "Vendor", "Amt", "Date Issued"];

  it("setColumn is pure and adds the parser type for amount/date fields", () => {
    const base = suggestMapping(headers, "ledger");
    const before = JSON.stringify(base);
    const next = setColumn(base, "ledger", "amount", "Amt");
    expect(JSON.stringify(base)).toBe(before);
    expect(next.columns.amount).toBe("Amt");
    expect(next.types?.amount).toBe("amount");
  });

  it("unmapping a field removes it and reports missing required fields", () => {
    const base = suggestMapping(headers, "ledger");
    const next = setColumn(base, "ledger", "payeeName", null);
    expect(next.columns.payeeName).toBeUndefined();
    expect(missingRequired(next, "ledger")).toContain("Payee name");
    expect(next.required).not.toContain("payeeName");
  });

  it("detects a header used by two fields", () => {
    const m = setColumn(setColumn({ columns: {} }, "clears", "amount", "X"), "clears", "clearedDate", "X");
    expect(duplicateHeaders(m)).toEqual(["X"]);
  });

  it("interprets /api/ingest responses", () => {
    const suggested = { columns: { amount: "Amt" } };
    expect(interpretIngestResponse(200, { needsMapping: true, suggested, headers: ["Amt"] })).toMatchObject({ type: "needsMapping" });
    expect(interpretIngestResponse(200, { inserted: 3, skipped: 1, errors: [{ row: 2, message: "bad" }] })).toEqual({
      type: "done",
      result: { inserted: 3, skipped: 1, errors: [{ row: 2, message: "bad" }], payeesLinked: undefined },
    });
    const err = interpretIngestResponse(422, { error: "No valid rows", errors: [{ row: 4, message: "bad date" }] });
    expect(err).toEqual({ type: "error", message: "No valid rows", details: ["row 4: bad date"] });
    expect(interpretIngestResponse(200, { nope: 1 }).type).toBe("error");
  });
});
