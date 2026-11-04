import { describe, expect, it } from "vitest";
import { FIRST_RUN_KEY, markFirstRun, readFirstRun, shouldWelcome, type FirstRunStorage } from "./first-run";
import { findMissing } from "./route-probe";
import { availableSteps, optionalPaths, progressLabel, skipTarget, TOUR_STEPS } from "./steps";

function memoryStorage(seed: Record<string, string> = {}): FirstRunStorage & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => (k in data ? (data[k] ?? null) : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const throwing: FirstRunStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("first-run persistence", () => {
  it("nothing remembered means the welcome shows", () => {
    expect(readFirstRun(memoryStorage())).toBeNull();
    expect(shouldWelcome(null, false)).toBe(true);
  });
  it("either answer is remembered and the welcome never shows again", () => {
    for (const choice of ["toured", "skipped"] as const) {
      const s = memoryStorage();
      expect(markFirstRun(choice, s)).toBe(true);
      expect(s.data[FIRST_RUN_KEY]).toBe(choice);
      expect(readFirstRun(s)).toBe(choice);
      expect(shouldWelcome(readFirstRun(s), false)).toBe(false);
    }
  });
  it("an open tour never shows the welcome over it", () => {
    expect(shouldWelcome(null, true)).toBe(false);
  });
  it("an unknown stored value counts as unanswered", () => {
    expect(readFirstRun(memoryStorage({ [FIRST_RUN_KEY]: "maybe" }))).toBeNull();
  });
  it("storage that throws or is missing never breaks the page", () => {
    expect(readFirstRun(throwing)).toBeNull();
    expect(markFirstRun("skipped", throwing)).toBe(false);
    expect(readFirstRun(null)).toBeNull();
    expect(markFirstRun("toured", null)).toBe(false);
  });
});

describe("step sequencing", () => {
  it("walks the product story in order", () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual([
      "exposure",
      "states",
      "item",
      "rules",
      "approvals",
      "close-out",
      "reports",
      "audit",
      "forecast",
      "horizon",
      "ledger",
      "recoveries",
      "runs",
      "chat",
    ]);
  });
  it("copy is short: at most two sentences, plain titles", () => {
    for (const s of TOUR_STEPS) {
      const sentences = s.narration.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
      expect(sentences.length, s.id).toBeLessThanOrEqual(2);
      expect(s.title.length, s.id).toBeLessThan(48);
    }
  });
  it("the item stop says the LLM never decides the law and explains UNVERIFIED", () => {
    const item = TOUR_STEPS.find((s) => s.id === "item")!;
    expect(item.narration).toMatch(/never decides the law/);
    expect(item.narration).toMatch(/UNVERIFIED/);
  });
  it("approvals explain the server-enforced gate and what pink means", () => {
    const a = TOUR_STEPS.find((s) => s.id === "approvals")!;
    expect(a.narration).toMatch(/server/);
    expect(a.narration).toMatch(/Pink/);
  });
  it("progress reads as 'N of M'", () => {
    expect(progressLabel(3, 12)).toBe("4 of 12");
    expect(progressLabel(0, 1)).toBe("1 of 1");
  });
});

describe("skip missing", () => {
  it("only optional stops are probed", () => {
    expect(optionalPaths(TOUR_STEPS).sort()).toEqual(["/horizon", "/ledger"]);
  });
  it("drops optional stops whose route is missing, keeps order", () => {
    const all = availableSteps(TOUR_STEPS, new Set());
    expect(all).toHaveLength(TOUR_STEPS.length);
    const without = availableSteps(TOUR_STEPS, new Set(["/horizon", "/ledger"]));
    expect(without.map((s) => s.id)).not.toContain("horizon");
    expect(without.map((s) => s.id)).not.toContain("ledger");
    expect(without).toHaveLength(12);
    expect(without.map((s) => s.id).indexOf("forecast") + 1).toBe(without.map((s) => s.id).indexOf("recoveries"));
  });
  it("never drops a required stop, even when its path is reported missing", () => {
    expect(availableSteps(TOUR_STEPS, new Set(["/dashboard", "/chat"]))).toHaveLength(TOUR_STEPS.length);
  });
  it("a stop with no anchor skips one stop in the direction of travel, never past either end", () => {
    expect(skipTarget(3, 1, 12)).toBe(4);
    expect(skipTarget(3, -1, 12)).toBe(2);
    expect(skipTarget(11, 1, 12)).toBeNull();
    expect(skipTarget(0, -1, 12)).toBeNull();
  });
  it("route probe: only a 404 is missing; errors and other statuses keep the stop", async () => {
    const status: Record<string, number> = { "/horizon": 404, "/ledger": 200, "/x": 307 };
    const missing = await findMissing(["/horizon", "/ledger", "/x", "/boom"], async (p) => {
      if (p === "/boom") throw new Error("offline");
      return status[p] ?? 500;
    });
    expect([...missing]).toEqual(["/horizon"]);
  });
});
