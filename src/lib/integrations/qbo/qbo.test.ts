import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { companies, ledgerItems, payees } from "@/db/schema";
import type { QboConfig } from "../config";
import { createConnectionStore, memoryRawStore, type ConnectionStore } from "../store";
import { authorizeUrl, createQboApi, exchangeCode, type FetchLike } from "./client";
import { isVoided, joinAddress, mapPurchase, pullQboChecks, type Purchase } from "./pull";

const cfg: QboConfig = { clientId: "cid", clientSecret: "csec", redirectUri: "http://localhost:3000/cb", apiBase: "https://sandbox-quickbooks.api.intuit.com" };

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function setup(): Promise<{ companyId: string; store: ConnectionStore; raw: ReturnType<typeof memoryRawStore> }> {
  const [c] = await t.db.insert(companies).values({ name: "QBO Co", incorporationState: "DE" }).returning();
  const raw = memoryRawStore();
  const store = createConnectionStore(raw, "sekret");
  await store.save({
    companyId: c!.id, provider: "qbo", realmId: "9130", accessToken: "AT1", refreshToken: "RT1",
    expiresAt: new Date(Date.now() + 3600_000), cursor: null,
  });
  return { companyId: c!.id, store, raw };
}

const purchase = (id: string, over: Partial<Purchase> = {}): Purchase => ({
  Id: id, DocNumber: `10${id}`, TxnDate: "2024-03-01", TotalAmt: 100.5,
  EntityRef: { value: "V1", name: "Bayline Electric", type: "Vendor" }, ...over,
});

describe("QBO mapping", () => {
  it("joins address lines and maps cents/date/number", () => {
    expect(joinAddress({ Line1: "1 Main St", Line2: " Suite 4 ", Line3: "" })).toBe("1 Main St, Suite 4");
    const m = mapPurchase(purchase("1", { TotalAmt: 1234.56 }), {
      Id: "V1", BillAddr: { Line1: "1 Main St", City: "Austin", CountrySubDivisionCode: "TX", PostalCode: "78701" },
    });
    expect(m.row).toMatchObject({
      number: "101", payeeName: "Bayline Electric", amount: 123456, issueDate: "2024-03-01",
      payeeAddress: "1 Main St", payeeCity: "Austin", payeeState: "TX", payeeZip: "78701", voided: false, kind: "check",
    });
  });

  it("only treats zero-amount + Void note as voided; uncertain cases stay not voided", () => {
    expect(isVoided(purchase("1", { TotalAmt: 0, PrivateNote: "Voided" }))).toBe(true);
    expect(isVoided(purchase("1", { TotalAmt: 0 }))).toBe(false);
    expect(isVoided(purchase("1", { TotalAmt: 50, PrivateNote: "void me later" }))).toBe(false);
  });

  it("skips check credits and rows without a payee", () => {
    expect(mapPurchase(purchase("1", { Credit: true }), undefined).skipped).toMatch(/credit/);
    expect(mapPurchase(purchase("1", { EntityRef: undefined }), undefined).skipped).toMatch(/payee/);
  });
});

describe("QBO OAuth + API client", () => {
  it("builds the authorize URL with state", () => {
    const u = new URL(authorizeUrl(cfg, "st8"));
    expect(u.origin + u.pathname).toBe("https://appcenter.intuit.com/connect/oauth2");
    expect(u.searchParams.get("state")).toBe("st8");
    expect(u.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting");
  });

  it("exchanges the code and stores tokens encrypted", async () => {
    const raw = memoryRawStore();
    const store = createConnectionStore(raw, "sekret");
    const f: FetchLike = async (url, init) => {
      expect(url).toBe("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
      expect(String(init?.body)).toContain("grant_type=authorization_code");
      return json({ access_token: "AT", refresh_token: "RT", expires_in: 3600 });
    };
    await exchangeCode(cfg, store, { companyId: "c1", code: "abc", realmId: "R" }, f);
    const row = raw.rows.get("c1:qbo")!;
    expect(row.accessTokenEnc).not.toContain("AT");
    expect(row.refreshTokenEnc?.startsWith("v1.")).toBe(true);
    expect((await store.get("c1", "qbo"))?.refreshToken).toBe("RT");
  });

  it("on 401 refreshes, persists the rotated refresh token, and retries once", async () => {
    const { companyId, store } = await setup();
    const calls: string[] = [];
    const f: FetchLike = async (url, init) => {
      calls.push(url.includes("tokens/bearer") ? "refresh" : `query:${(init?.headers as Record<string, string>).Authorization}`);
      if (url.includes("tokens/bearer")) return json({ access_token: "AT2", refresh_token: "RT2", expires_in: 3600 });
      const auth = (init?.headers as Record<string, string>).Authorization;
      return auth === "Bearer AT1" ? json({ fault: "expired" }, 401) : json({ QueryResponse: {} });
    };
    const api = createQboApi({ cfg, store, companyId, fetch: f });
    const { z } = await import("zod");
    await api.query("select * from Purchase", z.object({ QueryResponse: z.object({}) }));
    expect(calls).toEqual(["query:Bearer AT1", "refresh", "query:Bearer AT2"]);
    expect((await store.get(companyId, "qbo"))?.refreshToken).toBe("RT2");
  });

  it("surfaces a Zod failure as an error instead of fake data", async () => {
    const { companyId, store } = await setup();
    const f: FetchLike = async () => json({ QueryResponse: { Purchase: [{ Id: 5, TotalAmt: "lots" }] } });
    await expect(pullQboChecks(t.db, companyId, { cfg, store, fetch: f })).rejects.toThrow(/failed validation/);
    expect(await t.db.select().from(ledgerItems).where(eq(ledgerItems.companyId, companyId))).toHaveLength(0);
  });
});

describe("pullQboChecks", () => {
  it("paginates, joins vendor addresses, tags source qbo, resolves payees, and is idempotent", async () => {
    const { companyId, store } = await setup();
    const pages = [
      [purchase("1"), purchase("2", { TotalAmt: 0, PrivateNote: "Voided" })],
      [purchase("3", { EntityRef: { value: "V2", name: "Lone Star Supply", type: "Vendor" }, TotalAmt: 9 })],
    ];
    const queries: string[] = [];
    const f: FetchLike = async (url) => {
      const q = new URL(url).searchParams.get("query")!;
      queries.push(q);
      if (q.includes("from Vendor")) {
        return json({
          QueryResponse: {
            Vendor: [
              { Id: "V1", BillAddr: { Line1: "1 Main St", Line2: "Ste 2", City: "Austin", CountrySubDivisionCode: "TX", PostalCode: "78701" } },
              { Id: "V2", BillAddr: { Line1: "9 Elm", City: "Dallas", CountrySubDivisionCode: "TX", PostalCode: "75001" } },
            ],
          },
        });
      }
      const start = Number(/startposition (\d+)/.exec(q)![1]);
      return json({ QueryResponse: { Purchase: pages[(start - 1) / 2] ?? [] } });
    };

    const res = await pullQboChecks(t.db, companyId, { cfg, store, fetch: f, pageSize: 2 });
    expect(queries.filter((q) => q.includes("from Purchase")).map((q) => /startposition (\d+) maxresults (\d+)/.exec(q)!.slice(1))).toEqual([
      ["1", "2"],
      ["3", "2"],
    ]);
    expect(queries.find((q) => q.includes("from Vendor"))).toContain("'V1','V2'");
    expect(res).toMatchObject({ fetched: 3, inserted: 3, voided: 1 });

    const items = await t.db.select().from(ledgerItems).where(eq(ledgerItems.companyId, companyId));
    expect(items.every((i) => i.source === "qbo")).toBe(true);
    expect(items.find((i) => i.referenceNumber === "101")).toMatchObject({ addressLine: "1 Main St, Ste 2", state: "TX", amountCents: 10050 });
    expect(items.find((i) => i.referenceNumber === "102")?.status).toBe("voided");
    expect(items.every((i) => i.payeeId)).toBe(true);
    expect(await t.db.select().from(payees).where(eq(payees.companyId, companyId))).toHaveLength(2);

    const again = await pullQboChecks(t.db, companyId, { cfg, store, fetch: f, pageSize: 2 });
    expect(again.inserted).toBe(0);
  });
});
