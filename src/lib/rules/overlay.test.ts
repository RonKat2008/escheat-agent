import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { ruleApprovals } from "@/db/schema";
import { loadBaseRules, loadRules, overlayVersions, pinRules } from "./load";
import { overlayRows, refreshRuleOverlay, setOverlayRows, type OverlayRow } from "./overlay";

const REAL_DE = readFileSync(path.resolve(process.cwd(), "rules/DE.json"), "utf8");

let dir: string;
beforeEach(() => {
  setOverlayRows([]);
  dir = mkdtempSync(path.join(tmpdir(), "rules-overlay-"));
  writeFileSync(path.join(dir, "DE.json"), REAL_DE);
});
afterEach(() => setOverlayRows([]));

const row = (over: Partial<OverlayRow> = {}): OverlayRow => {
  const base = loadBaseRules("DE", { dir });
  return {
    state: "DE",
    kind: "verify",
    baseVersion: base.file.version,
    baseSha256: base.sha256,
    version: `${base.file.version}+appr.20261103T120000`,
    fieldPaths: ["interest"],
    value: null,
    ownerText: null,
    sources: [],
    note: null,
    approvedBy: "Dana",
    approvedAt: "2026-11-03T12:00:00.000Z",
    ...over,
  };
};

describe("rule overlay loader (R4-02)", () => {
  it("overlays approvals made against the exact checked-in baseline, in order", () => {
    const base = loadBaseRules("DE", { dir });
    const r1 = row();
    const r2 = row({ version: `${base.file.version}+appr.20261103T120500`, fieldPaths: ["propertyTypes.vendor_check.dormancyYears"], approvedBy: "Lee", approvedAt: "2026-11-03T12:05:00.000Z" });
    const loaded = loadRules("DE", { dir, overlay: [r1, r2] });
    expect(loaded.file.version).toBe(r2.version);
    expect(loaded.file.interest).toMatchObject({ verified: true, verified_by: "Dana" });
    expect(loaded.file.propertyTypes.vendor_check!.dormancyYears).toMatchObject({ verified: true, verified_by: "Lee" });
    expect(loaded).toMatchObject({ approvals: 2, baseSha256: base.sha256 });
    expect(loaded.sha256).not.toBe(base.sha256);
    expect(overlayVersions(base, { overlay: [r1, r2] }).map((v) => v.file.version)).toEqual([r1.version, r2.version]);
    expect(pinRules("DE", r1.version, { dir, overlay: [r1, r2] }).file.propertyTypes.vendor_check!.dormancyYears.verified).toBe(false);
    // The checked-in file is the baseline and is never touched.
    expect(readFileSync(path.join(dir, "DE.json"), "utf8")).toBe(REAL_DE);
  });

  it("ignores approvals for another state or another baseline, and stops at one that no longer applies", () => {
    const base = loadBaseRules("DE", { dir });
    expect(loadRules("DE", { dir, overlay: [row({ state: "TX" }), row({ baseSha256: "0".repeat(64) })] }).sha256).toBe(base.sha256);
    const broken = row({ version: "x+appr.2", fieldPaths: ["nope.field"] });
    const later = row({ version: "x+appr.3", fieldPaths: ["propertyTypes.vendor_check.dormancyYears"] });
    const loaded = loadRules("DE", { dir, overlay: [row(), broken, later] });
    expect(loaded.approvals).toBe(1);
    expect(loaded.file.propertyTypes.vendor_check!.dormancyYears.verified).toBe(false);
  });

  it("uses the in-process cache by default", () => {
    setOverlayRows([row()]);
    expect(loadRules("DE", { dir }).file.interest.verified).toBe(true);
    expect(loadRules("DE", { dir, overlay: [] }).file.interest.verified).toBe(false);
  });
});

describe("overlay cache refresh", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(() => t.close());

  it("reads rule_approvals oldest first; a missing table reads as no approvals", async () => {
    const r = row();
    await t.db.insert(ruleApprovals).values({ ...r, approvedAt: new Date(r.approvedAt), sources: [] });
    await refreshRuleOverlay(t.db);
    expect(overlayRows()).toEqual([r]);
    await t.db.execute(sql`drop table rule_approvals`);
    await refreshRuleOverlay(t.db);
    expect(overlayRows()).toEqual([]);
  });
});
