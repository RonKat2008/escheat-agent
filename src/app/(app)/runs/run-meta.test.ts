import { describe, expect, it } from "vitest";
import { gateHref } from "./run-meta";

describe("gateHref", () => {
  it("sends a paused filing run to the report gate for its state", () => {
    expect(gateHref("filing_agent", { reportId: "r1", state: "TX" }, null)).toEqual({ href: "/reports?state=TX", label: "Review on Reports" });
    expect(gateHref("filing_agent", { reportId: "r1" }, "ca")).toEqual({ href: "/reports?state=CA", label: "Review on Reports" });
  });
  it("sends claim runs to Recoveries and anything else to Approvals", () => {
    expect(gateHref("claim_agent", { recoveryId: "x" }, null)).toEqual({ href: "/recoveries", label: "Review on Recoveries" });
    expect(gateHref("letter_writer", {}, null)).toEqual({ href: "/approvals", label: "Review in Approvals" });
  });
  it("falls back to /reports when a filing run has no known state", () => {
    expect(gateHref("filing_agent", {}, null).href).toBe("/reports");
  });
});
