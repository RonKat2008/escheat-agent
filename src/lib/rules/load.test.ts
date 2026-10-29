import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { stateRules } from "@/db/schema";
import { parseRuleFile } from "../../../rules/schema";
import { diffRules } from "./diff";
import {
  RuleLoadError, approveRuleField, approveRuleFile, loadRules, pinRules, ruleFileFromRow, saveRuleVersion,
  sha256Hex, syncRulesToDb, tryLoadRules,
} from "./load";
import { listRuleValues } from "./values";
import { rv, simpleFile } from "./__fixtures__";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "rules-"));
});
const write = (name: string, obj: unknown) => writeFileSync(path.join(dir, name), typeof obj === "string" ? obj : JSON.stringify(obj));

describe("loader", () => {
  it("loads, validates and hashes", () => {
    const text = JSON.stringify(simpleFile());
    write("ZZ.json", text);
    const l = loadRules("zz", { dir });
    expect(l.file.state).toBe("ZZ");
    expect(l.sha256).toBe(sha256Hex(text));
    expect(l.warnings).toEqual([]);
  });
  it("rejects malformed JSON, wrong shapes and state/filename mismatch", () => {
    write("ZZ.json", "{not json");
    expect(() => loadRules("ZZ", { dir })).toThrow(RuleLoadError);
    write("ZZ.json", { state: "ZZ" });
    expect(() => loadRules("ZZ", { dir })).toThrow(/invalid rule file/);
    write("ZZ.json", JSON.stringify([1, 2]));
    expect(() => loadRules("ZZ", { dir })).toThrow(RuleLoadError);
    write("ZZ.json", { ...simpleFile(), state: "ZY" });
    expect(() => loadRules("ZZ", { dir })).toThrow(/does not match filename/);
    write("ZZ.json", { ...simpleFile(), state: "zz" });
    expect(() => loadRules("ZZ", { dir })).toThrow(RuleLoadError);
    expect(() => loadRules("ZZZ", { dir })).toThrow(/Invalid state/);
  });
  it("rejects a nameless or duplicate report stage", () => {
    const f = JSON.parse(JSON.stringify(simpleFile()));
    f.reportStages.push({ asOfRule: null });
    expect(parseRuleFile(f).ok).toBe(false);
    const g = JSON.parse(JSON.stringify(simpleFile()));
    g.reportStages.push(g.reportStages[0]);
    expect(parseRuleFile(g).ok).toBe(false);
  });
  it("missing file => tryLoadRules null (UNKNOWN), loadRules throws", () => {
    expect(tryLoadRules("QQ", { dir })).toBeNull();
    expect(() => loadRules("QQ", { dir })).toThrow(/No rule file/);
  });
  it("a value of the wrong shape becomes null + warning instead of crashing", () => {
    const f = JSON.parse(JSON.stringify(simpleFile()));
    f.propertyTypes.vendor_check.dormancyYears.value = "three";
    f.reportStages[0].dueRule.value = { type: "mystery" };
    f.dueDiligence.windowDaysBeforeReport.value = { min: 120, max: 60 };
    f.remitRule.verified = true;
    delete f.interest;
    const r = parseRuleFile(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.propertyTypes.vendor_check!.dormancyYears.value).toBeNull();
    expect(r.file.reportStages[0]!.dueRule.value).toBeNull();
    expect(r.file.dueDiligence.windowDaysBeforeReport.value).toBeNull();
    expect(r.file.interest.value).toBeNull();
    expect(r.warnings.map((w) => w.path)).toEqual(
      expect.arrayContaining(["propertyTypes.vendor_check.dormancyYears", "reportStages[0].dueRule", "dueDiligence.windowDaysBeforeReport", "interest"]),
    );
  });
  it("accepts bare values, wrapped includesRemittance and drops bad sources with a warning", () => {
    const f = JSON.parse(JSON.stringify(simpleFile()));
    f.businessDayRollForward = true;
    f.reportStages[0].includesRemittance = { value: true, sources: [], verified: false };
    f.remitRule.sources = [{ nope: 1 }, f.remitRule.sources[0]];
    const r = parseRuleFile(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.businessDayRollForward).toMatchObject({ value: true, verified: false, sources: [] });
    expect(r.file.reportStages[0]!.includesRemittance).toBe(true);
    expect(r.file.remitRule.sources).toHaveLength(1);
    expect(r.warnings.some((w) => w.path === "remitRule.sources[0]")).toBe(true);
  });
  it("ignores unknown property types with a warning", () => {
    const f = JSON.parse(JSON.stringify(simpleFile()));
    f.propertyTypes.gift_card = f.propertyTypes.vendor_check;
    const r = parseRuleFile(f);
    expect(r.ok && r.warnings.some((w) => w.path === "propertyTypes.gift_card")).toBe(true);
  });
});

describe("pinning and versions", () => {
  it("pins current or historical versions", () => {
    const v1 = simpleFile({ version: "v1" });
    write("ZZ.json", v1);
    saveRuleVersion(simpleFile({ version: "v2" }), { dir });
    expect(loadRules("ZZ", { dir }).file.version).toBe("v2");
    expect(pinRules("ZZ", "v2", { dir }).file.version).toBe("v2");
    expect(pinRules("ZZ", "v1", { dir }).file.version).toBe("v1"); // archived by saveRuleVersion
    expect(() => pinRules("ZZ", "v9", { dir })).toThrow(/not found/);
  });
  it("never overwrites an existing different history version", () => {
    saveRuleVersion(simpleFile({ version: "v1" }), { dir });
    const changed = simpleFile({ version: "v1" });
    changed.notes = ["edited"];
    expect(() => saveRuleVersion(changed, { dir })).toThrow(/Refusing/);
    expect(() => saveRuleVersion(simpleFile({ version: "v1" }), { dir })).not.toThrow(); // identical is fine
  });
  it("makeCurrent false only writes history", () => {
    saveRuleVersion(simpleFile({ version: "v1" }), { dir });
    saveRuleVersion(simpleFile({ version: "v2" }), { dir, makeCurrent: false });
    expect(loadRules("ZZ", { dir }).file.version).toBe("v1");
    expect(pinRules("ZZ", "v2", { dir }).file.version).toBe("v2");
  });
});

describe("approval", () => {
  it("approveRuleField verifies one field immutably", () => {
    const f = simpleFile();
    f.propertyTypes.vendor_check!.dormancyYears = rv(3, false);
    const g = approveRuleField(f, "propertyTypes.vendor_check.dormancyYears", "ronit", "2026-10-29T00:00:00Z");
    expect(g.propertyTypes.vendor_check!.dormancyYears).toMatchObject({ verified: true, verified_by: "ronit" });
    expect(f.propertyTypes.vendor_check!.dormancyYears.verified).toBe(false);
    expect(() => approveRuleField(f, "nope", "x", "y")).toThrow(RuleLoadError);
  });
  it("approveRuleFile skips null values unless includeNull", () => {
    const f = simpleFile({ interest: rv<never>(null, false), businessDayRollForward: rv(true, false) });
    const g = approveRuleFile(f, "me", "t");
    expect(g.businessDayRollForward.verified).toBe(true);
    expect(g.interest.verified).toBe(false);
    expect(approveRuleFile(f, "me", "t", { includeNull: true }).interest.verified).toBe(true);
  });
  it("approved version is saved as a new version file and round-trips", () => {
    const f = simpleFile({ version: "v1", businessDayRollForward: rv(true, false) });
    const g = { ...approveRuleFile(f, "me", "t"), version: "v1-approved" };
    saveRuleVersion(f, { dir });
    saveRuleVersion(g, { dir });
    const back = loadRules("ZZ", { dir }).file;
    expect(back.version).toBe("v1-approved");
    expect(back.businessDayRollForward.verified_by).toBe("me");
    expect(diffRules(f, back).some((c) => c.path === "businessDayRollForward" && c.kind === "verification_only")).toBe(true);
    expect(readFileSync(path.join(dir, "history", "ZZ", "v1.json"), "utf8")).toContain('"v1"');
  });
});

describe("diffRules", () => {
  it("identical files => no changes", () => {
    expect(diffRules(simpleFile(), simpleFile())).toEqual([]);
  });
  it("reports value, source and verification changes with paths", () => {
    const a = simpleFile();
    const b = simpleFile({ version: "v2" });
    b.propertyTypes.vendor_check!.dormancyYears = { ...rv(5), sources: [{ url: "https://example.test/new", title: "", quote: "q", retrieved_at: "" }] };
    b.dueDiligence.required = rv(true, false);
    b.reportStages[0]!.dueRule = rv({ type: "fixed_date" as const, month: 12, day: 1, yearOffset: 0 });
    delete b.propertyTypes.unapplied_cash;
    const changes = diffRules(a, b);
    const by = Object.fromEntries(changes.map((c) => [c.path, c]));
    expect(by["propertyTypes.vendor_check.dormancyYears"]).toMatchObject({ kind: "changed", before: 3, after: 5, sourcesChanged: true });
    expect(by["dueDiligence.required"]).toMatchObject({ kind: "verification_only", beforeVerified: true, afterVerified: false });
    expect(by["reportStages[annual].dueRule"]!.kind).toBe("changed");
    expect(by["propertyTypes.unapplied_cash.dormancyYears"]!.kind).toBe("removed");
    expect(diffRules(b, a).find((c) => c.path === "propertyTypes.unapplied_cash.dormancyYears")!.kind).toBe("added");
  });
  it("detects a source-only change", () => {
    const b = simpleFile();
    b.remitRule = { ...b.remitRule, sources: [] };
    expect(diffRules(simpleFile(), b)).toMatchObject([{ path: "remitRule", kind: "sources_only", sourcesChanged: true }]);
  });
});

describe("syncRulesToDb (PGlite)", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.close();
  });

  it("upserts one row per property type, idempotently", async () => {
    write("ZZ.json", simpleFile());
    const res = await syncRulesToDb(t.db, { dir });
    expect(res).toMatchObject([{ state: "ZZ", version: "test-v1", rows: 4, verified: true }]);
    await syncRulesToDb(t.db, { dir });
    const rows = await t.db.select().from(stateRules).where(eq(stateRules.state, "ZZ"));
    expect(rows).toHaveLength(4);
    const vc = rows.find((r) => r.propertyType === "vendor_check")!;
    expect(vc).toMatchObject({ dormancyMonths: 36, ddWindowDaysMin: 60, ddWindowDaysMax: 120, minReportableCents: 0, verified: true });
    expect(vc.ruleFileSha).toBe(res[0]!.sha256);
    expect(vc.sourceUrls).toContain("https://example.test/fixture-statute");
    expect(Object.keys(vc.fieldSources!)).toContain("propertyTypes.vendor_check.dormancyYears");
    expect(vc.reportStages).toHaveLength(1);
    expect(ruleFileFromRow(vc).version).toBe("test-v1");
  });
  it("verified is false if any field is unverified; re-sync updates in place", async () => {
    const f = simpleFile();
    f.businessDayRollForward = rv(true, false);
    write("ZZ.json", f);
    expect((await syncRulesToDb(t.db, { dir }))[0]!.verified).toBe(false);
    write("ZZ.json", { ...f, businessDayRollForward: rv(true, true) });
    await syncRulesToDb(t.db, { dir });
    const rows = await t.db.select().from(stateRules);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.verified)).toBe(true);
  });
  it("stores a new version as new rows and skips missing property types", async () => {
    const f = simpleFile();
    delete f.propertyTypes.payroll_check;
    write("ZZ.json", f);
    await syncRulesToDb(t.db, { dir });
    write("ZZ.json", { ...f, version: "v2" });
    await syncRulesToDb(t.db, { dir });
    expect(await t.db.select().from(stateRules)).toHaveLength(6);
  });
  it("lists only valid state files", () => {
    mkdirSync(path.join(dir, "history"));
    write("ZZ.json", simpleFile());
    write("notes.json", "{}");
    expect(listRuleValues(simpleFile()).length).toBeGreaterThan(20);
  });
});
