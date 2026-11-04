import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { reports } from "@/db/schema";
import { loadCloseSnapshot } from "@/lib/close-out/plan";
import { insertFixture, type FixtureItem } from "@/lib/queries/test-fixtures";

let t: TestDb;
vi.mock("@/lib/outreach/db", () => ({ getOutreachDb: async () => t.db }));

import { POST } from "./route";

const CHECKSUM = "c".repeat(64);
const ITEMS: FixtureItem[] = [
  { key: "a", check: "91001", payee: "Lone Star Supply", cents: 77_374, issueDate: "2023-01-01", state: "TX", status: "to_report", report: "2026-07-01", remit: "2026-07-01" },
  { key: "z", check: "91009", payee: "Zinnia Court Market", cents: 22_626, issueDate: "2023-01-01", state: "TX", status: "to_report", ddEnd: "2026-06-01", report: "2026-07-01", remit: "2026-07-01" },
];

let companyId: string;
let reportId: string;

beforeEach(async () => {
  vi.stubEnv("DEMO_ANCHOR_DATE", "2026-11-01");
  vi.stubEnv("DEMO_MODE", "1");
  t = await createTestDb();
  companyId = (await insertFixture(t.db, ITEMS)).companyId;
  const [r] = await t.db
    .insert(reports)
    .values({ companyId, state: "TX", reportYear: 2026, status: "validated", itemCount: 2, totalCents: 100_000, checksum: CHECKSUM, validationErrors: [], stage: "annual" })
    .returning();
  reportId = r!.id;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await t.close();
});

const call = (body: Record<string, unknown>, id = reportId) =>
  POST(new Request("http://x", { method: "POST", body: JSON.stringify({ approvedBy: "Dana Reyes", expectedChecksum: CHECKSUM, ...body }) }), { params: Promise.resolve({ id }) });
const statusOf = async () => (await t.db.select().from(reports).where(eq(reports.id, reportId)))[0]!.status;

describe("POST /api/reports/[id]/approve: the 'approve anyway' acknowledgement", () => {
  it("refuses with no acknowledgement when the file relies on unverified rules (409) and approves nothing", async () => {
    const res = await call({});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "unverified_not_acknowledged" });
    expect(await statusOf()).toBe("validated");
  });

  it("refuses a stale count, then a missing never-sent-notice acknowledgement", async () => {
    const unverified = (await loadCloseSnapshot(t.db, companyId, "TX")).unverifiedRulePaths.length;
    expect(unverified).toBeGreaterThan(0);
    expect((await call({ acknowledgedUnverified: unverified + 1 })).status).toBe(409);
    const res = await call({ acknowledgedUnverified: unverified });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "unsent_not_acknowledged" });
    expect(await statusOf()).toBe("validated");
  });

  it("approves once both counts are acknowledged, and freezes them on the filing record", async () => {
    const unverified = (await loadCloseSnapshot(t.db, companyId, "TX")).unverifiedRulePaths.length;
    const res = await call({ acknowledgedUnverified: unverified, acknowledgedUnsent: 1 });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "approved", unverifiedAcknowledged: unverified, unsentAcknowledged: 1 });
    expect(await statusOf()).toBe("approved");
  });

  it("404s for an unknown report", async () => {
    expect((await call({}, crypto.randomUUID())).status).toBe(404);
  });
});
