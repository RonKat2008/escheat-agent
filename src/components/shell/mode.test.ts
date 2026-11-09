import { describe, expect, it } from "vitest";
import { LAST_DASHBOARD_KEY, modeOf, readLastDashboard, safeDashboardPath, toggleTarget, writeLastDashboard, type StorageLike } from "./mode";

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceeded");
  },
};

describe("modeOf", () => {
  it("is ask for /ask and anything below it", () => {
    expect(modeOf("/ask")).toBe("ask");
    expect(modeOf("/ask/x")).toBe("ask");
    expect(modeOf("/ask?q=hi")).toBe("ask");
  });

  it("is dashboard for every other path, including look-alikes", () => {
    expect(modeOf("/askew")).toBe("dashboard");
    expect(modeOf("/dashboard")).toBe("dashboard");
    expect(modeOf("/items?x")).toBe("dashboard");
    expect(modeOf("/")).toBe("dashboard");
    expect(modeOf("/chat")).toBe("dashboard");
  });
});

describe("last dashboard path", () => {
  it("falls back to /dashboard when storage throws", () => {
    expect(readLastDashboard(() => throwing)).toBe("/dashboard");
    expect(() => writeLastDashboard(() => throwing, "/items")).not.toThrow();
  });

  it("falls back to /dashboard when the accessor itself throws or there is no storage", () => {
    expect(
      readLastDashboard(() => {
        throw new Error("blocked");
      }),
    ).toBe("/dashboard");
    expect(readLastDashboard(() => null)).toBe("/dashboard");
    expect(readLastDashboard(memory)).toBe("/dashboard");
  });

  it("round-trips a dashboard path with its query and ignores Ask paths", () => {
    const s = memory();
    writeLastDashboard(() => s, "/items?view=needs-action");
    expect(readLastDashboard(() => s)).toBe("/items?view=needs-action");
    writeLastDashboard(() => s, "/ask");
    expect(s.data.get(LAST_DASHBOARD_KEY)).toBe("/items?view=needs-action");
  });

  it("never returns an unsafe or Ask path", () => {
    expect(safeDashboardPath("//evil.com")).toBe("/dashboard");
    expect(safeDashboardPath("https://evil.com")).toBe("/dashboard");
    expect(safeDashboardPath("/\\evil")).toBe("/dashboard");
    expect(safeDashboardPath("/ask")).toBe("/dashboard");
    expect(safeDashboardPath("/reports?state=CA")).toBe("/reports?state=CA");
  });
});

describe("toggleTarget", () => {
  it("goes to Ask from any dashboard page and back to the last dashboard page from Ask", () => {
    expect(toggleTarget("/items", "/items")).toBe("/ask");
    expect(toggleTarget("/ask", "/items")).toBe("/items");
    expect(toggleTarget("/ask", "/ask")).toBe("/dashboard");
  });
});
