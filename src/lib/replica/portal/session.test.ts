import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./session";

describe("safeReturnTo (R7-11)", () => {
  const slug = "tx-holder";
  it("keeps a path and query inside the same portal", () => {
    expect(safeReturnTo(slug, "/replica/tx-holder/dashboard?filed=REPL-TX-2026-C3DQX5")).toBe("/replica/tx-holder/dashboard?filed=REPL-TX-2026-C3DQX5");
    expect(safeReturnTo(slug, "/replica/tx-holder/review/abc")).toBe("/replica/tx-holder/review/abc");
  });
  it("refuses anything that could leave the portal", () => {
    for (const bad of [
      "https://evil.example/replica/tx-holder/dashboard",
      "//evil.example/replica/tx-holder/x",
      "/\\evil.example",
      "/replica/ca-holder/dashboard",
      "/replica/tx-holder/../ca-holder/dashboard",
      "/replica/tx-holder/%2e%2e/ca-holder",
      "/replica/tx-holder/\r\nSet-Cookie: x=1",
      "/replica/tx-holder",
      "/dashboard",
      "javascript:alert(1)",
      "",
      null,
      42,
    ]) {
      expect(safeReturnTo(slug, bad)).toBeNull();
    }
  });
});
