import { describe, expect, it } from "vitest";
import { drawerOffersDraft } from "./draft-eligibility";

describe("drawerOffersDraft", () => {
  it("offers a draft while the due-diligence work is still open", () => {
    for (const s of ["watching", "dd_pending", "dd_sent", "owner_responded", "needs_rule"] as const) expect(drawerOffersDraft(s)).toBe(true);
  });

  it("hides the button for items the draft route always refuses (reported, in the report queue, closed)", () => {
    for (const s of ["reported", "to_report", "resolved_paid", "remitted"] as const) expect(drawerOffersDraft(s)).toBe(false);
  });
});
