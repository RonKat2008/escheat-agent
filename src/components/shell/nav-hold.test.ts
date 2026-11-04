import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isNavigationPending,
  isRouterNavigationClick,
  markNavigationDone,
  markNavigationStart,
  NAV_HOLD_MS,
  NAV_PENDING_MAX_MS,
  navigationHold,
  resetNavigationState,
  subscribeNavigation,
} from "./nav-hold";

const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
const here = { origin: "http://localhost:3000", pathname: "/items", search: "" };
const anchor = (href: string, extra: Partial<{ target: string; hasDownload: boolean }> = {}) => ({ href, target: "", hasDownload: false, ...extra });

describe("navigation hold", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetNavigationState();
  });
  afterEach(() => {
    resetNavigationState();
    vi.useRealTimers();
  });

  it("does not hold outside a navigation (server render, hydration, hard load)", () => {
    expect(navigationHold(1_000)).toBeNull();
  });

  it("holds for the rest of the window after a navigation starts, with one stable promise", () => {
    markNavigationStart(1_000);
    const first = navigationHold(1_010);
    expect(first).toBeInstanceOf(Promise);
    expect(navigationHold(1_200)).toBe(first);
    expect(navigationHold(1_000 + NAV_HOLD_MS)).toBeNull();
  });

  it("resolves the hold when the window ends, so the skeleton renders for slow pages", async () => {
    markNavigationStart(0);
    const hold = navigationHold(0);
    let done = false;
    void hold?.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(NAV_HOLD_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it("starts a fresh hold for each navigation", () => {
    markNavigationStart(0);
    const a = navigationHold(10);
    markNavigationStart(100);
    const b = navigationHold(110);
    expect(b).not.toBe(a);
    expect(navigationHold(100 + NAV_HOLD_MS - 1)).toBe(b);
  });

  it("ends the hold and the pending state once the new URL commits", () => {
    const seen: boolean[] = [];
    subscribeNavigation(() => seen.push(isNavigationPending()));
    markNavigationStart(0);
    expect(isNavigationPending()).toBe(true);
    markNavigationDone();
    expect(isNavigationPending()).toBe(false);
    expect(navigationHold(10)).toBeNull();
    expect(seen).toEqual([true, false]);
  });

  it("gives up on a navigation that never commits", () => {
    markNavigationStart(0);
    vi.advanceTimersByTime(NAV_PENDING_MAX_MS);
    expect(isNavigationPending()).toBe(false);
  });
});

describe("isRouterNavigationClick", () => {
  it("accepts a plain left click on an internal link to another URL", () => {
    expect(isRouterNavigationClick(click, anchor("/approvals"), here)).toBe(true);
    expect(isRouterNavigationClick(click, anchor("http://localhost:3000/items?state=CA"), here)).toBe(true);
  });

  it("ignores the current URL, other origins, new tabs, downloads and modified clicks", () => {
    expect(isRouterNavigationClick(click, anchor("/items"), here)).toBe(false);
    expect(isRouterNavigationClick(click, anchor("/items#row-4"), here)).toBe(false);
    expect(isRouterNavigationClick(click, anchor("https://example.com/"), here)).toBe(false);
    expect(isRouterNavigationClick(click, anchor("/approvals", { target: "_blank" }), here)).toBe(false);
    expect(isRouterNavigationClick(click, anchor("/report.csv", { hasDownload: true }), here)).toBe(false);
    expect(isRouterNavigationClick({ ...click, metaKey: true }, anchor("/approvals"), here)).toBe(false);
    expect(isRouterNavigationClick({ ...click, button: 1 }, anchor("/approvals"), here)).toBe(false);
    expect(isRouterNavigationClick({ ...click, defaultPrevented: true }, anchor("/approvals"), here)).toBe(false);
  });
});
