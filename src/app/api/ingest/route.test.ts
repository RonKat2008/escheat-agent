import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { companies } from "@/db/schema";

let t: TestDb;
vi.mock("@/db/client", async (orig) => ({
  ...(await orig<typeof import("@/db/client")>()),
  getDb: async () => t.db,
}));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://x/api/ingest", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

describe("POST /api/ingest", () => {
  it("400 on non-JSON and on schema violations", async () => {
    expect((await post("not json")).status).toBe(400);
    const res = await post({ kind: "nope", csv: "", companyId: "x" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid request");
  });

  it("404 for unknown company", async () => {
    const res = await post({ kind: "ledger", csv: "a\n1", companyId: crypto.randomUUID() });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Company not found" });
  });

  it("round-trips needsMapping then ingest", async () => {
    const [c] = await t.db.insert(companies).values({ name: "R", incorporationState: "CA" }).returning();
    const csv = "Check #,Payee,Amount,Date\n5,Acme Co,\"$1,000.00\",3/4/2024";
    const first = await post({ kind: "ledger", csv, companyId: c!.id });
    const body = await first.json();
    expect(first.status).toBe(200);
    expect(body.needsMapping).toBe(true);
    const second = await post({ kind: "ledger", csv, companyId: c!.id, mapping: body.suggested });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ inserted: 1, errors: [] });
  });
});
