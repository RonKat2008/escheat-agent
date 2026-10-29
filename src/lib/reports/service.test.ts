import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { companies, ledgerItems, payees, staleItems } from "@/db/schema";
import { assertApproved, ApprovalRequiredError } from "@/lib/approvals";
import { loadRules } from "@/lib/rules/load";
import {
  approveReport,
  buildReportEvidencePack,
  generateStateReport,
  listReportSummaries,
  readReportFile,
  ReportServiceError,
} from "./service";

let t: TestDb;
let dir: string;
let companyId: string;

async function seedItem(state: string, status: "to_report" | "watching", n: number, cents = 234000) {
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
  await t.db.insert(staleItems).values({
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
  });
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
    const approved = await approveReport(t.db, report.id, "Pat");
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
});
