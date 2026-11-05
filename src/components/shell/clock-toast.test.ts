import { describe, expect, it } from "vitest";
import { detectedToast, outOfScopeOf } from "./clock-toast";
import { toastLayout } from "./toast-layout";

describe("detectedToast", () => {
  it("uses the API's real count and amount, plural", () => {
    expect(detectedToast({ count: 6, cents: 372_718 })).toEqual({ message: "6 new stale items detected · $3,727.18", href: "/items", linkLabel: "Open items" });
  });

  it("singular for exactly one", () => {
    expect(detectedToast({ count: 1, cents: 12_000 })?.message).toBe("1 new stale item detected · $120.00");
  });

  it("separates thousands in the count", () => {
    expect(detectedToast({ count: 1_204, cents: 5 })?.message).toBe("1,204 new stale items detected · $0.05");
  });

  it("says nothing when nothing was detected or the field is missing", () => {
    expect(detectedToast({ count: 0, cents: 0 })).toBeNull();
    expect(detectedToast(undefined)).toBeNull();
    expect(detectedToast({ count: Number.NaN, cents: 1 })).toBeNull();
  });
});

describe("toastLayout", () => {
  it("is the corner default when no tour is open", () => {
    expect(toastLayout(null)).toMatchObject({ position: "bottom-right", offset: { bottom: 16 } });
  });

  it("lifts toasts above the phone sheet by its height plus a gap", () => {
    const l = toastLayout({ sheet: true, sheetHeight: 400.2 });
    expect(l.offset.bottom).toBe(413);
    expect(l.mobileOffset.bottom).toBe(413);
  });

  it("moves toasts to the bottom-left while the floating card is open", () => {
    expect(toastLayout({ sheet: false, sheetHeight: 300 })).toMatchObject({ position: "bottom-left", offset: { bottom: 16 } });
  });
});

describe("out-of-scope count in the detected toast", () => {
  it("appends the real count and states", () => {
    const m = detectedToast({ count: 6, cents: 372_718, outOfScope: { count: 2, states: ["FL", "IL"] } })?.message;
    expect(m).toBe("6 new stale items detected · $3,727.18, 2 in states we don't cover yet (FL, IL)");
  });

  it("is unchanged when absent or zero (backward compatible)", () => {
    expect(detectedToast({ count: 6, cents: 100, outOfScope: { count: 0, states: [] } })?.message).toBe("6 new stale items detected · $1.00");
    expect(detectedToast({ count: 6, cents: 100 })?.message).toBe("6 new stale items detected · $1.00");
  });

  it("outOfScopeOf splits byState by rule coverage", () => {
    expect(outOfScopeOf({ CA: 3, FL: 1, IL: 1, UNKNOWN: 2 }, ["CA", "NY"])).toEqual({ count: 4, states: ["FL", "IL"] });
    expect(outOfScopeOf({ CA: 3 }, ["CA"])).toBeNull();
  });
});
