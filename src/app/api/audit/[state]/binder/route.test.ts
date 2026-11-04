import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { insertFixture } from "@/lib/queries/test-fixtures";

let t: TestDb;
vi.mock("@/db/client", async (orig) => {
  const m = await orig<typeof import("@/db/client")>();
  return { ...m, getDb: async () => t.db };
});

import { GET } from "./route";

const ctx = (state: string) => ({ params: Promise.resolve({ state }) });
const get = (state: string, query = "", headers: Record<string, string> = {}) =>
  GET(new Request(`http://localhost/api/audit/${state}/binder${query}`, { headers }), ctx(state));

async function sessionCookie(): Promise<string> {
  const { createSessionValue, SESSION_COOKIE } = await import("@/app/login/gate");
  return `${SESSION_COOKIE}=${createSessionValue("pw-for-test")}`;
}

beforeAll(async () => {
  t = await createTestDb();
  await insertFixture(t.db, [
    { key: "a", check: "91001", payee: "Synthetic Delta", cents: 120000, issueDate: "2021-02-01", state: "DE", status: "dd_pending", unverified: true, ruleVersion: "2026.10.1-draft", ddStart: "2026-10-01", ddEnd: "2026-12-31", report: "2027-03-01", remit: "2027-03-01" },
    { key: "b", check: "91002", payee: "Synthetic Epsilon", cents: 60000, issueDate: "2021-03-01", state: "DE", status: "watching", ruleVersion: "2026.10.1-draft" },
  ]);
});
afterAll(async () => {
  await t.close();
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/audit/:state/binder", () => {
  it("refuses without a passcode session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSCODE", "pw-for-test");
    expect((await get("DE")).status).toBe(401);
  });

  it("rejects an unsupported state or sample size", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSCODE", "pw-for-test");
    const cookie = await sessionCookie();
    expect((await get("NY", "", { cookie })).status).toBe(400);
    expect((await get("DE", "?size=7", { cookie })).status).toBe(400);
  });

  it("returns a PDF binder with a cover page and one page per sampled item", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSCODE", "pw-for-test");
    const res = await get("de", "?size=5", { cookie: await sessionCookie() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-audit-seed")).toMatch(/^[0-9a-f]{64}$/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });
});
