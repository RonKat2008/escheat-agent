import { describe, expect, it } from "vitest";
import { createTestDb } from "@/db/client";
import { demoInvariantProblems, DemoResetBlockedError, demoResetBlocker, resetDemoData } from "./reset";

describe("demoResetBlocker", () => {
  it("allows a local PGlite database in demo mode", () => {
    expect(demoResetBlocker({ DEMO_MODE: "1" })).toBeNull();
    expect(demoResetBlocker({ DEMO_ANCHOR_DATE: "2026-11-01" })).toBeNull();
  });

  it("refuses whenever a hosted database is configured, even in demo mode", () => {
    expect(demoResetBlocker({ DATABASE_URL: "postgres://x", DEMO_MODE: "1" })).toMatch(/hosted database/);
  });

  it("refuses outside demo mode", () => {
    expect(demoResetBlocker({})).toMatch(/demo mode/);
    expect(demoResetBlocker({ DEMO_MODE: "0", DEMO_ANCHOR_DATE: "2026-11-01" })).toMatch(/demo mode/);
  });

  it("in production-like deployments needs an explicit DEMO_MODE=1 (an anchor date is not enough)", () => {
    expect(demoResetBlocker({ NODE_ENV: "production", DEMO_ANCHOR_DATE: "2026-11-01" })).toMatch(/production/);
    expect(demoResetBlocker({ VERCEL: "1", DEMO_ANCHOR_DATE: "2026-11-01" })).toMatch(/production/);
    expect(demoResetBlocker({ NODE_ENV: "production", DEMO_MODE: "1" })).toBeNull();
  });
});

describe("resetDemoData", () => {
  it("throws before touching the database when blocked", async () => {
    const t = await createTestDb();
    try {
      await expect(resetDemoData(t.db, { DATABASE_URL: "postgres://x", DEMO_MODE: "1" })).rejects.toBeInstanceOf(DemoResetBlockedError);
      await expect(resetDemoData(t.db, {})).rejects.toBeInstanceOf(DemoResetBlockedError);
    } finally {
      await t.close();
    }
  });
});

describe("demoInvariantProblems", () => {
  it("is empty for the seed numbers and names every drift", () => {
    expect(demoInvariantProblems({ items: 47, totalCents: 6_191_500, byState: { CA: 21, TX: 15, DE: 11 } })).toEqual([]);
    const bad = demoInvariantProblems({ items: 46, totalCents: 6_000_000, byState: { CA: 21, TX: 15 } });
    expect(bad).toHaveLength(3);
    expect(bad.join(";")).toContain("$61,915.00");
  });
});
