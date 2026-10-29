import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, ruleChanges } from "@/db/schema";
import { applyRuleApproval, RuleApplyError } from "./apply";
import { loadRules } from "./load";
import { listRuleValues } from "./values";

let t: TestDb;
let dir: string;
beforeEach(async () => {
  t = await createTestDb();
  dir = mkdtempSync(path.join(tmpdir(), "rules-apply-"));
  writeFileSync(path.join(dir, "CA.json"), readFileSync(path.resolve(process.cwd(), "rules/CA.json"), "utf8")); // real file: has unverified values
});
afterEach(() => t.close());

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
  });

  it("rejects when the file changed after the reviewer opened it (stale version/sha), writing nothing", async () => {
    const { expectedVersion, expectedSha256 } = seen();
    // someone else edits rules/CA.json
    const text = readFileSync(path.join(dir, "CA.json"), "utf8").replace(/\n?$/, "\n");
    writeFileSync(path.join(dir, "CA.json"), `${text}\n`);
    const before = readFileSync(path.join(dir, "CA.json"), "utf8");
    await expect(applyRuleApproval(t.db, { state: "CA", by: "Dana", expectedVersion, expectedSha256 }, { dir })).rejects.toMatchObject({ code: "stale" });
    expect(readFileSync(path.join(dir, "CA.json"), "utf8")).toBe(before);
    expect(await t.db.select().from(approvals)).toHaveLength(0);
    expect(await t.db.select().from(ruleChanges)).toHaveLength(0);
    await expect(applyRuleApproval(t.db, { state: "CA", by: "Dana", expectedVersion: "other", expectedSha256 }, { dir })).rejects.toBeInstanceOf(RuleApplyError);
  });

  it("approve-all lists the exact field paths in the approval payload", async () => {
    const { expectedVersion, expectedSha256, l } = seen();
    const expected = listRuleValues(l.file).filter((v) => !v.rv.verified && v.rv.value !== null).map((v) => v.path).sort();
    const res = await applyRuleApproval(t.db, { state: "CA", by: "Dana", expectedVersion, expectedSha256 }, { dir });
    expect(res.fieldPaths).toEqual(expected);
  });
});
