import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { eq } from "drizzle-orm";
import { companies, ledgerItems, payees, reports, staleItems } from "@/db/schema";
import * as clock from "@/lib/clock";
import { assertApproved, ApprovalRequiredError, ReviewedContentChangedError } from "@/lib/approvals";
import { loadRules } from "@/lib/rules/load";
import {
  approveReport,
  buildReportEvidencePack,
  generateStateReport,
  listReportSummaries,
  readReportFile,
  ReportServiceError,
} from "./service";
import type { ValidationError } from "./validate";
import { summarizeValidation } from "./validation-summary";

let t: TestDb;
let dir: string;
let companyId: string;

async function seedItem(state: string, status: "to_report" | "watching", n: number, cents = 234000): Promise<string> {
  const [p] = await t.db
    .insert(payees)
    .values({ companyId, canonicalName: `Bayline Electric ${n}`, addressLine: "55 Harbor St", city: "Oakland", state, zip: "94607" })
    .returning();
  const [l] = await t.db
    .insert(ledgerItems)
    .values({
      companyId,
      payeeId: p!.id,
      payeeNameRaw: p!.canonicalName,
      propertyType: "vendor_check",
      referenceNumber: String(10480 + n),
      amountCents: cents,
      issueDate: "2023-01-15",
    })
    .returning();
  const [s] = await t.db.insert(staleItems).values({
    companyId,
    ledgerItemId: l!.id,
    ownerPayeeId: p!.id,
    amountCents: cents,
    propertyType: "vendor_check",
    ownerState: state,
    ownerStateBasis: "address",
    lastActivityDate: "2023-01-15",
    status,
    staleSince: "2023-07-14",
    reportStage: loadRules(state).file.reportStages[0]!.name,
    ruleVersion: loadRules(state).file.version,
  }).returning();
  return s!.id;
}

beforeEach(async () => {
  t = await createTestDb();
  dir = await mkdtemp(path.join(os.tmpdir(), "reports-"));
  const [c] = await t.db
    .insert(companies)
    .values({ name: "Northwind Fixtures, Inc.", incorporationState: "DE", hqState: "TX", city: "Austin" })
    .returning();
  companyId = c!.id;
});
afterEach(async () => {
  await t.close();
  await rm(dir, { recursive: true, force: true });
});

describe("report service", () => {
  it("generates a validated NAUPA file for the state's to_report items only", async () => {
    await seedItem("CA", "to_report", 1);
    await seedItem("CA", "to_report", 2, 50000);
    await seedItem("CA", "watching", 3);
    await seedItem("TX", "to_report", 4);
    const r = await generateStateReport(t.db, companyId, "ca", { dataDir: dir });
    expect(r.report.state).toBe("CA");
    expect(r.report.itemCount).toBe(2);
    expect(r.report.totalCents).toBe(284000);
    expect(r.report.checksum).toMatch(/^[0-9a-f]{64}$/);
    const { text } = await readReportFile(t.db, r.report.id);
    expect(text).toContain("BAYLINE ELECTRIC");
    expect(text).toContain("000000000"); // synthetic holder TIN
    expect(["draft", "validated"]).toContain(r.report.status);
    expect(r.report.status).toBe(r.errors.some((e) => e.severity === "error") ? "draft" : "validated");
  });

  it("R6-13: the generate summary counts exactly what the stored list (runner, record, pack) counts, builder notes included", async () => {
    await seedItem("CA", "to_report", 1);
    const r = await generateStateReport(t.db, companyId, "CA", { dataDir: dir });
    const [stored] = await t.db.select().from(reports).where(eq(reports.id, r.report.id));
    const fromStored = summarizeValidation(((stored!.validationErrors ?? []) as ValidationError[]).filter(Boolean));
    expect(fromStored).toEqual(r.summary);
    // CA's notice-report A/R note is a builder-only warning: it must be in the stored list, not only in the live result.
    expect(r.errors.some((e) => e.field === "file note")).toBe(r.warnings.some((w) => w.startsWith("CA notice report")));
  });

  it("refuses when nothing is in to_report", async () => {
    await seedItem("CA", "watching", 1);
    await expect(generateStateReport(t.db, companyId, "CA", { dataDir: dir })).rejects.toMatchObject({ code: "no_items" });
    await expect(generateStateReport(t.db, companyId, "NY", { dataDir: dir })).rejects.toMatchObject({ code: "no_rules" });
  });

  it("regenerating replaces the unapproved report", async () => {
    await seedItem("CA", "to_report", 1);
    await generateStateReport(t.db, companyId, "CA", { dataDir: dir });
    await generateStateReport(t.db, companyId, "CA", { dataDir: dir });
    const s = (await listReportSummaries(t.db, companyId)).find((x) => x.state === "CA")!;
    expect(s.toReportCount).toBe(1);
    expect(s.history).toHaveLength(0);
    expect(s.latest).not.toBeNull();
  });

  it("a submitted report is locked: regenerating never deletes it, and it stays the current report for its cycle", async () => {
    await seedItem("CA", "to_report", 1);
    const first = await generateStateReport(t.db, companyId, "CA", { dataDir: dir });
    await t.db.update(reports).set({ status: "confirmed", replicaConfirmation: "REPL-1" }).where(eq(reports.id, first.report.id));
    await t.db.update(staleItems).set({ status: "reported" }).where(eq(staleItems.status, "to_report"));
    const s = (await listReportSummaries(t.db, companyId)).find((x) => x.state === "CA")!;
    expect(s.latest?.id).toBe(first.report.id);
    expect(s.locked).toBe(true);
    // New item in the same cycle: a second report is created next to the locked one.
    await seedItem("CA", "to_report", 2);
    const second = await generateStateReport(t.db, companyId, "CA", { dataDir: dir });
    expect(second.report.id).not.toBe(first.report.id);
    const kept = await t.db.select().from(reports).where(eq(reports.id, first.report.id));
    expect(kept[0]?.status).toBe("confirmed");
  });

  it("reports are keyed by state + stage + report year: next year's cycle starts fresh", async () => {
    await seedItem("CA", "to_report", 1);
    const first = await generateStateReport(t.db, companyId, "CA", { dataDir: dir });
    await t.db.update(reports).set({ status: "confirmed", replicaConfirmation: "REPL-1" }).where(eq(reports.id, first.report.id));
    await t.db.update(staleItems).set({ status: "reported" }).where(eq(staleItems.status, "to_report"));
    await clock.advanceClock(t.db, companyId, 366);
    await seedItem("CA", "to_report", 2);
    const s = (await listReportSummaries(t.db, companyId)).find((x) => x.state === "CA")!;
    expect(s.latest).toBeNull();
    expect(s.locked).toBe(false);
    expect(s.history.map((h) => h.id)).toEqual([first.report.id]);
    const next = await generateStateReport(t.db, companyId, "CA", { dataDir: dir });
    expect(next.report.reportYear).toBe(first.report.reportYear + 1);
    const after = (await listReportSummaries(t.db, companyId)).find((x) => x.state === "CA")!;
    expect(after.latest?.id).toBe(next.report.id);
    expect(after.history.map((h) => h.id)).toEqual([first.report.id]);
  });

  it("regenerating only replaces open reports of the same stage", async () => {
    await seedItem("CA", "to_report", 1);
    const a = await generateStateReport(t.db, companyId, "CA", { dataDir: dir });
    await t.db.update(reports).set({ stage: "Some other stage" }).where(eq(reports.id, a.report.id));
    await generateStateReport(t.db, companyId, "CA", { dataDir: dir });
    expect(await t.db.select().from(reports).where(eq(reports.id, a.report.id))).toHaveLength(1);
  });

  it("approval binds to the file checksum and is required by assertApproved", async () => {
    await seedItem("TX", "to_report", 1);
    const { report } = await generateStateReport(t.db, companyId, "TX", { dataDir: dir });
    await expect(assertApproved(t.db, { action: "submit_report", subjectId: report.id, payload: report.checksum })).rejects.toBeInstanceOf(
      ApprovalRequiredError,
    );
    if (report.status === "draft") {
      await expect(approveReport(t.db, report.id, "Pat")).rejects.toBeInstanceOf(ReportServiceError);
      return;
    }
    await expect(approveReport(t.db, report.id, "Pat", { expectedChecksum: "0".repeat(64) })).rejects.toBeInstanceOf(ReviewedContentChangedError);
    const approved = await approveReport(t.db, report.id, "Pat", { expectedChecksum: report.checksum! });
    expect(approved.status).toBe("approved");
    await expect(assertApproved(t.db, { action: "submit_report", subjectId: report.id, payload: report.checksum })).resolves.toBeTruthy();
    await expect(approveReport(t.db, report.id, "Pat")).rejects.toMatchObject({ code: "not_approvable" });
  });

  it("builds an evidence pack PDF", async () => {
    await seedItem("DE", "to_report", 1);
    const { report } = await generateStateReport(t.db, companyId, "DE", { dataDir: dir });
    const pack = await buildReportEvidencePack(t.db, report.id, { dataDir: dir });
    const bytes = await readFile(pack.path);
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(pack.pageCount).toBeGreaterThan(0);
  });

  it("builds the evidence pack from the report's own items after filing moved them to Reported", async () => {
    const a = await seedItem("CA", "to_report", 1);
    const b = await seedItem("CA", "to_report", 2, 1200); // under the CA threshold: an aggregate row in the file
    const c = await seedItem("CA", "to_report", 3, 50000);
    const { report } = await generateStateReport(t.db, companyId, "CA", { dataDir: dir });
    expect((await readReportFile(t.db, report.id)).text).toContain("AGGREGATE OF 1 ITEMS");
    // What the filing agent does on submit, then a new item reaches To Report for the next report.
    await t.db.update(reports).set({ status: "submitted", submittedAt: new Date() }).where(eq(reports.id, report.id));
    await t.db.update(staleItems).set({ status: "reported" }).where(eq(staleItems.companyId, companyId));
    const later = await seedItem("CA", "to_report", 4, 70000);

    const pack = await buildReportEvidencePack(t.db, report.id, { dataDir: dir });
    expect([...pack.itemIds].sort()).toEqual([a, b, c].sort());
    expect(pack.itemIds).not.toContain(later);
    expect((await readFile(pack.path)).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("refuses the evidence pack when the file no longer matches the items", async () => {
    const a = await seedItem("CA", "to_report", 1);
    const { report } = await generateStateReport(t.db, companyId, "CA", { dataDir: dir });
    await t.db.update(staleItems).set({ status: "resolved_paid" }).where(eq(staleItems.id, a));
    await expect(buildReportEvidencePack(t.db, report.id, { dataDir: dir })).rejects.toMatchObject({ code: "no_items" });
  });
});
