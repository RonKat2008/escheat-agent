import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { agentRuns, approvals, companies, ledgerItems, payees, reports, staleItems } from "@/db/schema";
import { approveReport, generateStateReport } from "@/lib/reports/service";
import { loadRules } from "@/lib/rules/load";

let t: TestDb;
vi.mock("@/db/client", async (orig) => ({
  ...(await orig<typeof import("@/db/client")>()),
  getDb: async () => t.db,
  migrate: async () => "pglite" as const,
}));
// The agent must never open a browser in a unit test; failing here is after the run row exists and before any approval is used.
vi.mock("@/lib/browser-agents/browser", async (orig) => ({
  ...(await orig<typeof import("@/lib/browser-agents/browser")>()),
  launchFencedBrowser: async () => {
    throw new Error("test: no browser");
  },
}));

const { POST } = await import("./route");

let dir: string;
let reportId: string;

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/agents/file", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(async () => {
  t = await createTestDb();
  dir = await mkdtemp(path.join(os.tmpdir(), "file-route-"));
  const [c] = await t.db.insert(companies).values({ name: "Northwind Fixtures, Inc.", incorporationState: "DE", hqState: "TX", city: "Austin" }).returning();
  const [p] = await t.db.insert(payees).values({ companyId: c!.id, canonicalName: "Bayline Electric", addressLine: "55 Harbor St", city: "Oakland", state: "CA", zip: "94607" }).returning();
  const [l] = await t.db
    .insert(ledgerItems)
    .values({ companyId: c!.id, payeeId: p!.id, payeeNameRaw: "Bayline Electric", propertyType: "vendor_check", referenceNumber: "10481", amountCents: 234000, issueDate: "2023-01-15" })
    .returning();
  await t.db.insert(staleItems).values({
    companyId: c!.id,
    ledgerItemId: l!.id,
    ownerPayeeId: p!.id,
    amountCents: 234000,
    propertyType: "vendor_check",
    ownerState: "CA",
    ownerStateBasis: "address",
    lastActivityDate: "2023-01-15",
    status: "to_report",
    staleSince: "2023-07-14",
    reportStage: loadRules("CA").file.reportStages[0]!.name,
    ruleVersion: loadRules("CA").file.version,
  });
  const r = await generateStateReport(t.db, c!.id, "CA", { dataDir: dir });
  reportId = r.report.id;
  // The minimal synthetic seed may fail the state validator; this suite is about the approval gate, not validation.
  await t.db.update(reports).set({ status: "validated" }).where(eq(reports.id, reportId));
});
afterEach(async () => {
  await t.close();
  await rm(dir, { recursive: true, force: true });
});

describe("POST /api/agents/file (R8-03)", () => {
  it("refuses to start before a person approved the file, and creates no run", async () => {
    const res = await post({ reportId });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("approval_required");
    expect(body.error).toMatch(/approval required/i);
    expect(await t.db.select().from(agentRuns)).toHaveLength(0);
  });

  it("starts (202) once approved, and does not consume the approval (the final submit does)", async () => {
    await approveReport(t.db, reportId, "Test Reviewer");
    const res = await post({ reportId });
    expect(res.status, await res.clone().text()).toBe(202);
    expect(((await res.json()) as { runId: string }).runId).toMatch(/^[0-9a-f-]{36}$/);
    const rows = await t.db.select().from(approvals).where(eq(approvals.subjectId, reportId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.consumedAt).toBeNull();
  });

  it("refuses again once the approval was consumed", async () => {
    await approveReport(t.db, reportId, "Test Reviewer");
    await t.db.update(approvals).set({ consumedAt: new Date() }).where(eq(approvals.subjectId, reportId));
    const res = await post({ reportId });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("consumed");
  });
});
