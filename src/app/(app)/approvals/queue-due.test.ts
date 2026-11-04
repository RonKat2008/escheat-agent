import { describe, expect, it } from "vitest";
import { queueDue } from "./queue-data";

describe("R9-13 the row date column", () => {
  it("shows Send by while the notice is still waiting", () => {
    expect(queueDue("awaiting_approval", null, "2027-05-02", "2027-11-01")).toEqual({ dueDate: "2027-05-02", dueLabel: "Send by" });
  });
  it("says when it went out once sent, instead of the deadline", () => {
    expect(queueDue("sent", "2026-11-01", "2027-05-02", null)).toEqual({ dueDate: "2026-11-01", dueLabel: "Sent" });
  });
  it("keeps the deadline if a sent row has no send date", () => {
    expect(queueDue("sent", null, "2027-05-02", null).dueLabel).toBe("Send by");
  });
});
