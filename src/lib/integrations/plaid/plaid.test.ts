import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { bankClears, companies } from "@/db/schema";
import type { PlaidConfig } from "../config";
import type { FetchLike } from "../qbo/client";
import { createConnectionStore, memoryRawStore } from "../store";
import { createLinkToken, exchangePublicToken } from "./client";
import { extractCheckNumber, mapPlaidTxn, syncPlaidClears } from "./sync";

const cfg: PlaidConfig = { clientId: "pid", secret: "psec", apiBase: "https://sandbox.plaid.com" };
let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const txn = (id: string, over: Record<string, unknown> = {}) => ({
  transaction_id: id, amount: 100, date: "2024-05-02", name: "ACH PAYMENT", check_number: null, pending: false, ...over,
});

describe("check number extraction", () => {
  it("prefers check_number and parses CHECK-style descriptions", () => {
    expect(extractCheckNumber({ check_number: "010482" })).toBe("10482");
    expect(extractCheckNumber({ name: "CHECK 10482" })).toBe("10482");
    expect(extractCheckNumber({ name: "Check #10483 paid" })).toBe("10483");
    expect(extractCheckNumber({ original_description: "CHK NO. 7731" })).toBe("7731");
    expect(extractCheckNumber({ name: "ACH PAYMENT 20240502" })).toBeUndefined();
  });

  it("keeps only settled debits that look like checks", () => {
    expect(mapPlaidTxn(txn("a", { name: "CHECK 10482", amount: 234.5 }) as never)).toEqual({
      checkNumber: "10482", amount: 23450, clearedDate: "2024-05-02", description: "CHECK 10482",
    });
    expect(mapPlaidTxn(txn("b", { name: "Check deposit", amount: 50 }) as never)?.checkNumber).toBeUndefined();
    expect(mapPlaidTxn(txn("c", { name: "CHECK 1", amount: -5 }) as never)).toBeUndefined(); // credit
    expect(mapPlaidTxn(txn("d", { name: "CHECK 10484", pending: true }) as never)).toBeUndefined();
    expect(mapPlaidTxn(txn("e") as never)).toBeUndefined(); // plain ACH
  });
});

describe("Plaid client", () => {
  it("creates a link token and exchanges a public token into encrypted storage", async () => {
    const f: FetchLike = async (url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.client_id).toBe("pid");
      if (url.endsWith("/link/token/create")) return json({ link_token: "link-sandbox-1" });
      return json({ access_token: "access-sandbox-1", item_id: "item1" });
    };
    expect(await createLinkToken(cfg, "co1", f)).toBe("link-sandbox-1");
    const raw = memoryRawStore();
    const store = createConnectionStore(raw, "sekret");
    await exchangePublicToken(cfg, store, { companyId: "co1", publicToken: "public-x" }, f);
    expect(raw.rows.get("co1:plaid")?.accessTokenEnc).not.toContain("access-sandbox-1");
    expect((await store.get("co1", "plaid"))?.accessToken).toBe("access-sandbox-1");
  });

  it("surfaces Plaid error bodies", async () => {
    const f: FetchLike = async () => json({ error_code: "INVALID_API_KEYS", error_message: "bad keys" }, 400);
    await expect(createLinkToken(cfg, "co1", f)).rejects.toThrow(/INVALID_API_KEYS/);
  });
});

describe("syncPlaidClears", () => {
  it("pages from the stored cursor, inserts check clears with source plaid, saves the cursor", async () => {
    const [c] = await t.db.insert(companies).values({ name: "Plaid Co", incorporationState: "DE" }).returning();
    const raw = memoryRawStore();
    const store = createConnectionStore(raw, "sekret");
    await store.save({ companyId: c!.id, provider: "plaid", realmId: "item1", accessToken: "acc", refreshToken: null, expiresAt: null, cursor: "c0" });

    const seen: unknown[] = [];
    const f: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      seen.push(body.cursor);
      if (body.cursor === "c0") {
        return json({
          added: [txn("1", { name: "CHECK 10482", amount: 234 }), txn("2")], modified: [], removed: [], next_cursor: "c1", has_more: true,
        });
      }
      return json({
        added: [txn("3", { check_number: "10483", name: "Check", amount: 80.25, date: "2024-05-09" })],
        modified: [], removed: [], next_cursor: "c2", has_more: false,
      });
    };
    const res = await syncPlaidClears(t.db, c!.id, { cfg, store, fetch: f });
    expect(seen).toEqual(["c0", "c1"]);
    expect(res).toMatchObject({ pages: 2, transactions: 3, inserted: 2, ignored: 1, cursor: "c2" });
    const rows = await t.db.select().from(bankClears).where(eq(bankClears.companyId, c!.id));
    expect(rows.map((r) => [r.referenceNumber, r.amountCents, r.source]).sort()).toEqual([
      ["10482", 23400, "plaid"],
      ["10483", 8025, "plaid"],
    ]);
    expect((await store.get(c!.id, "plaid"))?.cursor).toBe("c2");
  });

  it("does not advance the cursor when the response fails validation", async () => {
    const [c] = await t.db.insert(companies).values({ name: "Plaid Co 2", incorporationState: "DE" }).returning();
    const store = createConnectionStore(memoryRawStore(), "sekret");
    await store.save({ companyId: c!.id, provider: "plaid", realmId: "i", accessToken: "acc", refreshToken: null, expiresAt: null, cursor: "c0" });
    const f: FetchLike = async () => json({ added: "nope" });
    await expect(syncPlaidClears(t.db, c!.id, { cfg, store, fetch: f })).rejects.toThrow(/failed validation/);
    expect((await store.get(c!.id, "plaid"))?.cursor).toBe("c0");
  });
});
