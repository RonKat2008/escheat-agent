import { describe, expect, it } from "vitest";
import { holePolygon, placePopover, ringPolygon, spotRect } from "./geometry";
import { atStep, cleanReadout, clampIndex, nextIndex, prevIndex, readoutValue, stepAt, stepHref, TOUR_CHECK, TOUR_STEPS, TOUR_TOTAL } from "./steps";
import { parseTourParam, TOUR_START_HREF, withoutTourParam } from "./tour-url";

describe("parseTourParam", () => {
  it("reads a 1-based stop into a 0-based index", () => {
    expect(parseTourParam("1", 10)).toBe(0);
    expect(parseTourParam("4", 10)).toBe(3);
  });
  it("clamps past the last stop instead of failing", () => {
    expect(parseTourParam("99", 10)).toBe(9);
  });
  it("treats missing, zero, negative and non-numeric values as no tour", () => {
    for (const v of [null, undefined, "", "0", "-2", "abc", "1.5", "2x", "1e3"]) expect(parseTourParam(v, 10)).toBeNull();
  });
  it("is never open for an empty tour", () => {
    expect(parseTourParam("1", 0)).toBeNull();
  });
});

describe("withoutTourParam", () => {
  it("drops only the tour param", () => {
    expect(withoutTourParam("?state=TX&tour=4&field=x")).toBe("?state=TX&field=x");
    expect(withoutTourParam("tour=2")).toBe("");
    expect(withoutTourParam("")).toBe("");
  });
});

describe("stop list", () => {
  it("follows the demo path: dashboard first, eval last, ids unique", () => {
    expect(TOUR_STEPS[0]?.path).toBe("/dashboard");
    expect(TOUR_STEPS.at(-1)?.path).toBe("/eval");
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_TOTAL);
    expect(TOUR_START_HREF).toBe(stepHref(stepAt(0), 0));
  });
  it("narration and titles carry no figures: numbers only come from readouts read off the page", () => {
    for (const s of TOUR_STEPS) {
      expect(s.narration, s.id).not.toMatch(/\d/);
      expect(s.title, s.id).not.toMatch(/\d/);
      expect(s.human ?? "", s.id).not.toMatch(/\d/);
    }
  });
  it("every stop has at least one anchor and a one-line narration", () => {
    for (const s of TOUR_STEPS) {
      expect(s.anchors.length, s.id).toBeGreaterThan(0);
      expect(s.narration.length, s.id).toBeLessThan(260);
    }
  });
  it("the approval stops tell the judge a person clicks, the tour does not", () => {
    expect(TOUR_STEPS.find((s) => s.id === "approvals")?.human).toMatch(/You click Approve/);
  });
});

describe("R5-06: stops land on content, not placeholders", () => {
  it("the check stop waits for the drawer's real header and lifecycle, never the bare table row", () => {
    const item = TOUR_STEPS.find((s) => s.id === "item")!;
    expect(item.loaded).toEqual(expect.arrayContaining(['[data-testid="item-drawer"] header h2', '[data-testid="item-lifecycle"]']));
    expect(item.anchors).not.toContain('[data-testid="items-row"]');
  });
  it("the recoveries stop hides a zero total and invites the judge to run the search", () => {
    const rec = TOUR_STEPS.find((s) => s.id === "recoveries")!;
    const found = rec.readouts!.find((r) => r.label === "Found")!;
    expect(readoutValue("$0.00", found.emptyWhen)).toBeNull();
    expect(readoutValue("$1,180.00", found.emptyWhen)).toBe("$1,180.00");
    expect(rec.invite?.target).toBe('[data-testid="run-recovery-btn"]');
    expect(rec.invite?.label).toBe("Run recovery search");
    for (const t of [rec.invite!.idle, rec.invite!.started, rec.invite!.label]) expect(t).not.toMatch(/\d/);
  });
  it("no stop invites an approval, a send or a filing", () => {
    for (const s of TOUR_STEPS) {
      if (!s.invite) continue;
      expect(s.invite.label, s.id).not.toMatch(/approve|send|submit|file|mail/i);
      expect(s.invite.target, s.id).not.toMatch(/approve|send|submit/i);
    }
  });
});

describe("progression", () => {
  it("moves forward and back and stops at the ends", () => {
    expect(nextIndex(0)).toBe(1);
    expect(nextIndex(TOUR_TOTAL - 1)).toBeNull();
    expect(prevIndex(3)).toBe(2);
    expect(prevIndex(0)).toBeNull();
  });
  it("clamps any index into range", () => {
    expect(clampIndex(-5)).toBe(0);
    expect(clampIndex(500)).toBe(TOUR_TOTAL - 1);
    expect(clampIndex(2.7)).toBe(2);
    expect(stepAt(500).id).toBe(TOUR_STEPS.at(-1)?.id);
  });
});

describe("stepHref / atStep", () => {
  const rules = TOUR_STEPS.find((s) => s.id === "rules")!;
  const item = TOUR_STEPS.find((s) => s.id === "item")!;
  it("builds the stop's URL with its query and a 1-based tour param", () => {
    expect(stepHref(rules, 3)).toBe("/rules?state=TX&field=dueDiligence.requiredLanguage&tour=4");
    expect(stepHref(item, 2, { item: "abc" })).toBe("/items?item=abc&tour=3");
  });
  it("matches only when path and required query are present", () => {
    expect(atStep(rules, "/rules", "state=TX&field=dueDiligence.requiredLanguage&tour=4")).toBe(true);
    expect(atStep(rules, "/rules", "state=CA&field=dueDiligence.requiredLanguage")).toBe(false);
    expect(atStep(rules, "/dashboard", "state=TX&field=dueDiligence.requiredLanguage")).toBe(false);
  });
  it("the check stop needs its drawer open, or the search fallback for that check", () => {
    expect(atStep(item, "/items", "?item=xyz&tour=3")).toBe(true);
    expect(atStep(item, "/items", `?q=${TOUR_CHECK}`)).toBe(true);
    expect(atStep(item, "/items", "?tour=3")).toBe(false);
    expect(atStep(item, "/items/", "?item=1")).toBe(true);
  });
});

describe("cleanReadout", () => {
  it("collapses whitespace, trims, clips and drops empties", () => {
    expect(cleanReadout("  $61,915.00 \n\n ")).toBe("$61,915.00");
    expect(cleanReadout("")).toBeNull();
    expect(cleanReadout(null)).toBeNull();
    const long = cleanReadout("x".repeat(300), 20)!;
    expect(long.length).toBe(20);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("geometry", () => {
  const vp = { w: 1440, h: 900 };
  it("pads the target and clips it to the viewport and below the top bar", () => {
    expect(spotRect({ x: 100, y: 100, w: 200, h: 50 }, vp)).toEqual({ x: 92, y: 92, w: 216, h: 66 });
    expect(spotRect({ x: -50, y: -400, w: 2000, h: 3000 }, vp, 8, 4, 52)).toEqual({ x: 4, y: 52, w: 1432, h: 844 });
  });
  it("hole and ring polygons always have the same 10-point shape (so clip-path can interpolate)", () => {
    const count = (p: string) => p.slice("polygon(".length, -1).split(",").length;
    const hole = { x: 10, y: 20, w: 30, h: 40 };
    expect(count(holePolygon({ x: 0, y: 0, ...{ w: 100, h: 100 } }, hole))).toBe(10);
    expect(count(holePolygon({ x: 0, y: 0, w: 100, h: 100 }, null))).toBe(10);
    expect(count(ringPolygon(hole))).toBe(10);
    expect(count(ringPolygon(null))).toBe(10);
    expect(holePolygon({ x: 0, y: 0, w: 100, h: 100 }, hole)).toBe("polygon(0px 0px, 0px 100px, 10px 100px, 10px 20px, 40px 20px, 40px 60px, 10px 60px, 10px 100px, 100px 100px, 100px 0px)");
  });
  it("places the popover below, then above, then beside the target, clamped inside the viewport", () => {
    const pop = { w: 400, h: 240 };
    expect(placePopover({ x: 100, y: 100, w: 200, h: 50 }, pop, vp).side).toBe("bottom");
    expect(placePopover({ x: 100, y: 700, w: 200, h: 50 }, pop, vp).side).toBe("top");
    expect(placePopover({ x: 100, y: 60, w: 300, h: 800 }, pop, vp).side).toBe("right");
    expect(placePopover({ x: 1000, y: 60, w: 300, h: 800 }, pop, vp).side).toBe("left");
    const p = placePopover({ x: 1400, y: 100, w: 30, h: 30 }, pop, vp);
    expect(p.x + pop.w).toBeLessThanOrEqual(vp.w - 16);
    expect(p.x).toBeGreaterThanOrEqual(16);
  });
  it("falls back to bottom-center when nothing fits, or when there is no target", () => {
    const pop = { w: 400, h: 240 };
    const huge = placePopover({ x: 0, y: 0, w: 1440, h: 900 }, pop, vp);
    expect(huge.side).toBe("center");
    expect(huge.y).toBe(vp.h - pop.h - 16);
    expect(placePopover(null, pop, vp)).toEqual({ x: 520, y: 644, side: "center" });
  });
});
