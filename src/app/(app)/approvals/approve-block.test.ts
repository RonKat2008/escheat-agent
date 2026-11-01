import { describe, expect, it } from "vitest";
import { approveBlockReason } from "./approve-block";

const ok = { composed: true, problems: [], needsRecipient: false, to: "", allowlisted: true, approver: "Ronit" };

describe("approveBlockReason", () => {
  it("is null when nothing blocks approval", () => {
    expect(approveBlockReason(ok)).toBeNull();
  });
  it("names an uncomposed draft first", () => {
    expect(approveBlockReason({ ...ok, composed: false, approver: "" })).toMatch(/compose the draft/);
  });
  it("surfaces the compose problem (the owner-link secret case) and counts the rest", () => {
    const msg = approveBlockReason({ ...ok, problems: ["owner response link unavailable: OWNER_LINK_SECRET is missing", "holder return address is missing"] });
    expect(msg).toBe("owner response link unavailable: OWNER_LINK_SECRET is missing (+1 more under Safety checks).");
  });
  it("then recipient, then approver", () => {
    expect(approveBlockReason({ ...ok, needsRecipient: true, to: " " })).toMatch(/choose a recipient/);
    expect(approveBlockReason({ ...ok, needsRecipient: true, to: "x@y.z", allowlisted: false })).toMatch(/allowlist/);
    expect(approveBlockReason({ ...ok, approver: "  " })).toMatch(/Approver/);
  });
});
