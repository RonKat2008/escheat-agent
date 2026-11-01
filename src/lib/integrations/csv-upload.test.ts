import { describe, expect, it } from "vitest";
import { suggestMapping } from "@/lib/ingest/mapping";
import { pipelineHeadline, duplicateHeaders, formatFileSize, interpretIngestResponse, MAX_CSV_BYTES, missingRequired, setColumn, validateCsvFile } from "./csv-upload";

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
    expect(interpretIngestResponse(200, { inserted: 3, skipped: 1, errorCount: 1, errorGroups: [{ message: "bad", count: 1, lines: [2] }] })).toEqual({
      type: "done",
      result: { inserted: 3, skipped: 1, errorCount: 1, errorGroups: [{ message: "bad", count: 1, lines: [2] }], payeesLinked: undefined },
    });
    const err = interpretIngestResponse(422, { error: "No valid rows", errors: [{ row: 4, message: "bad date" }] });
    expect(err).toEqual({ type: "error", message: "No valid rows", details: ["line 4: bad date"] });
    const grouped = interpretIngestResponse(422, {
      error: "No valid rows",
      errorGroups: [{ field: "kind", message: "unknown kind 'x'", count: 648, lines: [2, 3, 4, 5, 6] }],
    });
    expect(grouped).toMatchObject({ details: ["648 rows: unknown kind 'x' (kind; lines 2, 3, 4, 5, 6, +643 more)"] });
    const pipeline = interpretIngestResponse(200, { inserted: 1, pipeline: { status: "ok", newStale: 2, updatedStale: 0, notYetStale: 4, thresholdDays: 180, asOf: "2026-11-01" } });
    expect(pipeline).toMatchObject({ result: { pipeline: { status: "ok", newStale: 2 } } });
    expect(interpretIngestResponse(200, { nope: 1 }).type).toBe("error");
  });

  it("validates the chosen file before upload", () => {
    expect(validateCsvFile({ name: "a.CSV", type: "", size: 10 })).toBeNull();
    expect(validateCsvFile({ name: "export", type: "text/csv", size: 10 })).toBeNull();
    expect(validateCsvFile({ name: "photo.png", type: "image/png", size: 10 })).toMatch(/not a CSV/);
    expect(validateCsvFile({ name: "a.csv", type: "text/csv", size: 0 })).toMatch(/empty/);
    expect(validateCsvFile({ name: "a.csv", type: "text/csv", size: MAX_CSV_BYTES + 1 })).toMatch(/larger/);
  });

  it("formats small and large file sizes", () => {
    expect(formatFileSize(12)).toBe("12 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
  });
});

describe("pipelineHeadline", () => {
  const ok = { status: "ok" as const, updatedStale: 0, asOf: "2026-11-01", thresholdDays: 180 };
  it("says how many new stale items were found", () => {
    expect(pipelineHeadline({ ...ok, newStale: 3, notYetStale: 0 })).toBe("3 new stale items found");
    expect(pipelineHeadline({ ...ok, newStale: 1, notYetStale: 0 })).toBe("1 new stale item found");
  });
  it("is honest when nothing is stale yet", () => {
    expect(pipelineHeadline({ ...ok, newStale: 0, notYetStale: 5 })).toBe("0 new stale items; 5 outstanding rows are not yet past the 180-day stale threshold");
  });
});
