import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, ruleApprovals, ruleChanges, stateRules } from "@/db/schema";
import { applyRuleApproval, RuleApplyError, withdrawRuleApproval } from "./apply";
import { loadBaseRules, loadRules, pinRules } from "./load";
import { setOverlayRows } from "./overlay";
import { listRuleValues } from "./values";

let t: TestDb;
let dir: string;
let original: string;
beforeEach(async () => {
  setOverlayRows([]);
  t = await createTestDb();
  dir = mkdtempSync(path.join(tmpdir(), "rules-apply-"));
  original = readFileSync(path.resolve(process.cwd(), "rules/CA.json"), "utf8");
  writeFileSync(path.join(dir, "CA.json"), original); // real file: has unverified values
});
afterEach(async () => {
  // R4-02: an approval never writes the rules directory.
  expect(readdirSync(dir)).toEqual(["CA.json"]);
  expect(readFileSync(path.join(dir, "CA.json"), "utf8")).toBe(original);
  setOverlayRows([]);
  await t.close();
});

const seen = () => {
  const l = loadRules("CA", { dir });
  return { expectedVersion: l.file.version, expectedSha256: l.sha256, l };
};

describe("applyRuleApproval (M3)", () => {
  it("records an apply_rule_change approval bound to version+sha+field paths, consumes it, and saves a new version", async () => {
    const { expectedVersion, expectedSha256, l } = seen();
    const target = listRuleValues(l.file).find((v) => !v.rv.verified && v.rv.value !== null);
    expect(target, "fixture needs an unverified value").toBeTruthy();
    const res = await applyRuleApproval(t.db, { state: "CA", path: target!.path, by: "Dana (passcode session abcd1234)", expectedVersion, expectedSha256 }, { dir });
    expect(res.fieldPaths).toEqual([target!.path]);
    const [ap] = await t.db.select().from(approvals).where(eq(approvals.id, res.approvalId));
    expect(ap).toMatchObject({ action: "apply_rule_change", subjectId: "CA", approvedBy: "Dana (passcode session abcd1234)" });
    expect(ap?.consumedAt).not.toBeNull();
    const after = loadRules("CA", { dir });
    expect(after.file.version).toBe(res.version);
    expect(listRuleValues(after.file).find((v) => v.path === target!.path)?.rv.verified).toBe(true);
    const [rc] = await t.db.select().from(ruleChanges);
    expect(rc).toMatchObject({ state: "CA", status: "applied", reviewedBy: "Dana (passcode session abcd1234)" });
    // R4-02: persisted as a DB approval (who, when, version) on the checked-in baseline.
    const [row] = await t.db.select().from(ruleApprovals);
    expect(row).toMatchObject({ state: "CA", kind: "verify", version: res.version, fieldPaths: [target!.path], approvedBy: "Dana (passcode session abcd1234)", baseSha256: expectedSha256 });
    expect(row?.approvalId).toBe(res.approvalId);
    // state_rules carries the new overlaid version.
    expect((await t.db.select().from(stateRules)).every((r) => r.version === res.version)).toBe(true);
  });

  it("rejects when the rules changed after the reviewer opened it (stale version/sha), writing nothing", async () => {
    const { expectedVersion, expectedSha256 } = seen();
    // Another session approves a value first: the overlaid version and sha move on.
    await applyRuleApproval(t.db, { state: "CA", path: "interest", by: "Other", expectedVersion, expectedSha256 }, { dir });
    const before = await t.db.select().from(approvals);
    await expect(applyRuleApproval(t.db, { state: "CA", by: "Dana", expectedVersion, expectedSha256 }, { dir })).rejects.toMatchObject({ code: "stale" });
    expect(await t.db.select().from(approvals)).toHaveLength(before.length);
    expect(await t.db.select().from(ruleApprovals)).toHaveLength(1);
    expect(await t.db.select().from(ruleChanges)).toHaveLength(1);
    await expect(applyRuleApproval(t.db, { state: "CA", by: "Dana", expectedVersion: "other", expectedSha256 }, { dir })).rejects.toBeInstanceOf(RuleApplyError);
  });

  it("approve-all lists the exact field paths in the approval payload", async () => {
    const { expectedVersion, expectedSha256, l } = seen();
    const expected = listRuleValues(l.file).filter((v) => !v.rv.verified && v.rv.value !== null).map((v) => v.path).sort();
    const res = await applyRuleApproval(t.db, { state: "CA", by: "Dana", expectedVersion, expectedSha256 }, { dir });
    expect(res.fieldPaths).toEqual(expected);
  });

  it("R4-20: approves exactly the paths the reviewer ticked, and rejects unknown ones", async () => {
    const { expectedVersion, expectedSha256 } = seen();
    const paths = ["interest", "propertyTypes.vendor_check.dormancyYears"];
    const res = await applyRuleApproval(t.db, { state: "CA", paths, by: "Dana", expectedVersion, expectedSha256 }, { dir });
    expect(res.fieldPaths).toEqual([...paths].sort());
    const next = seen();
    await expect(
      applyRuleApproval(t.db, { state: "CA", paths: ["nope.field"], by: "Dana", expectedVersion: next.expectedVersion, expectedSha256: next.expectedSha256 }, { dir }),
    ).rejects.toMatchObject({ code: "unknown_field" });
  });

  it("overlay: each approval is a pinnable version; the baseline still pins; a new checked-in baseline drops old approvals", async () => {
    const a = seen();
    const r1 = await applyRuleApproval(t.db, { state: "CA", path: "interest", by: "Dana", expectedVersion: a.expectedVersion, expectedSha256: a.expectedSha256 }, { dir, now: new Date() });
    const b = seen();
    const r2 = await applyRuleApproval(t.db, { state: "CA", path: "propertyTypes.vendor_check.dormancyYears", by: "Lee", expectedVersion: b.expectedVersion, expectedSha256: b.expectedSha256 }, { dir });
    expect(loadRules("CA", { dir })).toMatchObject({ approvals: 2, baseSha256: a.expectedSha256 });
    expect(new Set([r1.version, r2.version]).size).toBe(2); // same-second approvals get distinct versions
    expect(pinRules("CA", r1.version, { dir }).file.interest.verified).toBe(true);
    expect(pinRules("CA", r1.version, { dir }).file.propertyTypes.vendor_check!.dormancyYears.verified).toBe(false);
    expect(pinRules("CA", a.expectedVersion, { dir }).sha256).toBe(a.expectedSha256);
    // A researcher checks in a new baseline: approvals made on the old bytes no longer apply (values unverified again).
    writeFileSync(path.join(dir, "CA.json"), `${original}\n`);
    expect(loadRules("CA", { dir }).approvals).toBe(0);
    writeFileSync(path.join(dir, "CA.json"), original);
    expect(loadBaseRules("CA", { dir }).sha256).toBe(a.expectedSha256);
  });
});

/* ------------------------------------------------------------------ F18: round-trip preservation */

type Json = Record<string, unknown>;
/** The overlaid rule text the loader serves (the checked-in file stays untouched, asserted in afterEach). */
const readRaw = () => loadRules("CA", { dir }).text;

/** Walk a rule path (as listRuleValues names it) to the raw envelope object in the parsed JSON. */
function rawAt(raw: Json, p: string): Json {
  const stage = /^reportStages\[(.+)\]\.(asOfRule|dueRule)$/.exec(p);
  if (stage) {
    const st = (raw.reportStages as Json[]).find((s) => s.name === stage[1])!;
    return st[stage[2]!] as Json;
  }
  return p.split(".").reduce<Json>((o, k) => o[k] as Json, raw);
}

describe("applyRuleApproval round-trip (F18)", () => {
  it("approving one value changes ONLY that envelope (plus version); every other byte is preserved", async () => {
    const before = readRaw();
    const { expectedVersion, expectedSha256 } = seen();
    const target = "propertyTypes.vendor_check.dormancyYears";
    // The approval is recorded on the real clock, so apply on the real clock too (a fixed date expires as time passes).
    const at = new Date();
    const res = await applyRuleApproval(
      t.db,
      { state: "CA", path: target, by: "Dana (passcode session abcd1234)", expectedVersion, expectedSha256 },
      { dir, now: at },
    );

    const expected = JSON.parse(before) as Json;
    expected.version = res.version;
    Object.assign(rawAt(expected, target), { verified: true, verified_by: "Dana (passcode session abcd1234)", verified_at: at.toISOString() });
    expect(readRaw()).toBe(`${JSON.stringify(expected, null, 2)}\n`);
  });

  it("keeps reportStages[].includesRemittance envelopes (value, sources, verified) intact", async () => {
    const beforeRaw = JSON.parse(readRaw()) as Json;
    const { expectedVersion, expectedSha256 } = seen();
    await applyRuleApproval(t.db, { state: "CA", path: "reportStages[notice].dueRule", by: "Dana", expectedVersion, expectedSha256 }, { dir });
    const afterRaw = JSON.parse(readRaw()) as Json;
    const inc = (r: Json) => (r.reportStages as Json[]).map((s) => s.includesRemittance);
    expect(inc(afterRaw)).toEqual(inc(beforeRaw));
    expect((inc(afterRaw)[0] as Json).sources).toBeInstanceOf(Array);
  });

  it("approve-all only touches the approved envelopes; null values, notes, portal and sources stay byte-identical", async () => {
    const before = readRaw();
    const { expectedVersion, expectedSha256, l } = seen();
    // The approval is recorded on the real clock, so apply on the real clock too (a fixed date expires as time passes).
    const at = new Date();
    const res = await applyRuleApproval(t.db, { state: "CA", by: "Dana", expectedVersion, expectedSha256 }, { dir, now: at });
    const expected = JSON.parse(before) as Json;
    expected.version = res.version;
    for (const v of listRuleValues(l.file)) {
      if (v.rv.verified || v.rv.value === null) continue;
      Object.assign(rawAt(expected, v.path), { verified: true, verified_by: "Dana", verified_at: at.toISOString() });
    }
    expect(readRaw()).toBe(`${JSON.stringify(expected, null, 2)}\n`);
  });

  it("works on a read-only rules directory (serverless): nothing under rules/ is written", async () => {
    chmodSync(path.join(dir, "CA.json"), 0o444);
    chmodSync(dir, 0o555);
    try {
      const { expectedVersion, expectedSha256 } = seen();
      const res = await applyRuleApproval(t.db, { state: "CA", path: "interest", by: "Dana", expectedVersion, expectedSha256 }, { dir });
      expect(loadRules("CA", { dir }).file.version).toBe(res.version);
    } finally {
      chmodSync(dir, 0o755);
      chmodSync(path.join(dir, "CA.json"), 0o644);
    }
  });
});

describe("withdrawRuleApproval (R4-02)", () => {
  it("withdraws only the latest approval, keeps the row for audit, and the rules fall back to the previous version", async () => {
    const a = seen();
    const r1 = await applyRuleApproval(t.db, { state: "CA", path: "interest", by: "Dana", expectedVersion: a.expectedVersion, expectedSha256: a.expectedSha256 }, { dir });
    await expect(withdrawRuleApproval(t.db, { state: "CA", version: a.expectedVersion, by: "Dana" }, { dir })).rejects.toMatchObject({ code: "stale" });
    const res = await withdrawRuleApproval(t.db, { state: "CA", version: r1.version, by: "Dana" }, { dir });
    expect(res).toEqual({ withdrawn: r1.version, current: a.expectedVersion });
    expect(loadRules("CA", { dir }).sha256).toBe(a.expectedSha256);
    const [row] = await t.db.select().from(ruleApprovals);
    expect(row).toMatchObject({ version: r1.version, withdrawnBy: "Dana" });
    expect(row?.withdrawnAt).not.toBeNull();
    // state_rules keeps one row set per version; the baseline version is synced again as current.
    expect((await t.db.select().from(stateRules)).some((r) => r.version === a.expectedVersion)).toBe(true);
  });
});
