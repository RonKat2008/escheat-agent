import { describe, expect, it } from "vitest";
import type { UiPayload } from "@/lib/chat/ui-types";
import { EXAMPLE_PROMPTS, followUpsFor } from "./followups";

const exposure = {
  kind: "exposure",
  props: {
    state: null,
    exposure: {
      asOf: "2026-11-01",
      itemCount: 3,
      anyUnverified: true,
      total: { cents: 600, formatted: "$6.00" },
      byState: [
        { state: "TX", cents: 100, formatted: "$1.00", count: 1, anyUnverified: true },
        { state: "CA", cents: 500, formatted: "$5.00", count: 2, anyUnverified: true },
      ],
    },
  },
} as unknown as UiPayload;

describe("follow-up chips", () => {
  it("derive from the views shown, largest state first, capped at three", () => {
    const chips = followUpsFor([exposure], ["What do we owe and where?"]);
    expect(chips).toEqual(["Show the open CA items", "What's due in the next 90 days?", "Which rules are unverified?"]);
  });

  it("skip questions already asked and fall back to examples", () => {
    const chips = followUpsFor([], [EXAMPLE_PROMPTS[0]]);
    expect(chips).not.toContain(EXAMPLE_PROMPTS[0]);
    expect(chips).toHaveLength(3);
  });

  it("never suggest approving, sending or filing", () => {
    const card = { kind: "approval_card", props: { checkNumber: "10482" } } as unknown as UiPayload;
    const all = [...followUpsFor([card], []), ...followUpsFor([exposure], [])];
    for (const q of all) expect(q).not.toMatch(/\b(approve|send|file|mail)\b/i);
  });
});
