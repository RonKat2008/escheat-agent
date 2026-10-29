import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { eq } from "drizzle-orm";
import { companies, ledgerItems, outreach, staleItems } from "@/db/schema";
import {
  assertOwnerTokenUsable,
  createOwnerToken,
  markOwnerTokenUsed,
  OwnerTokenConfigError,
  OwnerTokenError,
  verifyOwnerToken,
} from "./tokens";

const SECRET = "test-secret-0123456789abcdef";
const now = new Date("2026-01-01T00:00:00Z");
const later = new Date("2026-01-08T00:00:00Z");

describe("owner tokens (pure)", () => {
  it("round-trips", () => {
    const { token, tokenHash } = createOwnerToken({ outreachId: "o1", expiresAt: later }, SECRET);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyOwnerToken(token, now, SECRET)).toEqual({ outreachId: "o1", exp: later.getTime() });
  });
  it("rejects expired (boundary inclusive)", () => {
    const { token } = createOwnerToken({ outreachId: "o1", expiresAt: later }, SECRET);
    expect(() => verifyOwnerToken(token, later, SECRET)).toThrow(expect.objectContaining({ reason: "expired" }));
  });
  it("rejects wrong secret", () => {
    const { token } = createOwnerToken({ outreachId: "o1", expiresAt: later }, SECRET);
    expect(() => verifyOwnerToken(token, now, "another-secret-0123456789")).toThrow(
      expect.objectContaining({ reason: "bad_signature" }),
    );
  });
  it("rejects tampered payload and signature", () => {
    const { token } = createOwnerToken({ outreachId: "o1", expiresAt: later }, SECRET);
    const [body, sig] = token.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ oid: "o2", exp: later.getTime() })).toString("base64url");
    expect(() => verifyOwnerToken(`${forged}.${sig}`, now, SECRET)).toThrow(OwnerTokenError);
    expect(() => verifyOwnerToken(`${body}.${sig.slice(0, -2)}AA`, now, SECRET)).toThrow(OwnerTokenError);
    const farFuture = Buffer.from(JSON.stringify({ oid: "o1", exp: 9e15 })).toString("base64url");
    expect(() => verifyOwnerToken(`${farFuture}.${sig}`, now, SECRET)).toThrow(OwnerTokenError);
  });
  it.each(["", "abc", "a.b.c", ".", "a.", ".b"])("rejects malformed %j", (tok) => {
    expect(() => verifyOwnerToken(tok, now, SECRET)).toThrow(OwnerTokenError);
  });
  it("signed but non-JSON / wrong-shape body is malformed", async () => {
    const { hmacSha256, toBase64Url } = await import("@/lib/crypto");
    for (const raw of ["not json", JSON.stringify({ oid: 1, exp: "x" })]) {
      const body = toBase64Url(raw);
      const tok = `${body}.${toBase64Url(hmacSha256(SECRET, body))}`;
      expect(() => verifyOwnerToken(tok, now, SECRET)).toThrow(expect.objectContaining({ reason: "malformed" }));
    }
  });
  it("throws config error when secret missing or short", () => {
    const prev = process.env.OWNER_LINK_SECRET;
    delete process.env.OWNER_LINK_SECRET;
    try {
      expect(() => createOwnerToken({ outreachId: "o", expiresAt: later })).toThrow(OwnerTokenConfigError);
      expect(() => createOwnerToken({ outreachId: "o", expiresAt: later }, "short")).toThrow(OwnerTokenConfigError);
      expect(() => verifyOwnerToken("a.b", now, "")).toThrow(OwnerTokenConfigError);
    } finally {
      if (prev !== undefined) process.env.OWNER_LINK_SECRET = prev;
    }
  });
});

describe("owner tokens (db single-use)", () => {
  let t: TestDb;
  let outreachId: string;
  let token: string;
  beforeAll(async () => {
    t = await createTestDb();
    const [c] = await t.db
      .insert(companies)
      .values({ name: "Northwind (SYNTHETIC)", incorporationState: "DE", hqState: "TX" })
      .returning();
    const [li] = await t.db
      .insert(ledgerItems)
      .values({ companyId: c!.id, payeeNameRaw: "Bayline Electric", propertyType: "vendor_check", amountCents: 100, issueDate: "2025-01-01" })
      .returning();
    const [si] = await t.db
      .insert(staleItems)
      .values({ companyId: c!.id, ledgerItemId: li!.id, amountCents: 100, propertyType: "vendor_check", staleSince: "2025-07-01" })
      .returning();
    const [o] = await t.db.insert(outreach).values({ companyId: c!.id, staleItemId: si!.id, channel: "email" }).returning();
    outreachId = o!.id;
    const created = createOwnerToken({ outreachId, expiresAt: later }, SECRET);
    token = created.token;
    await t.db.update(outreach).set({ tokenHash: created.tokenHash }).where(eq(outreach.id, outreachId));
  });
  afterAll(async () => {
    await t.close();
  });

  it("usable once, then already_used; marking twice throws", async () => {
    await expect(assertOwnerTokenUsable(t.db, token, now, SECRET)).resolves.toMatchObject({ outreachId });
    await markOwnerTokenUsed(t.db, outreachId, now);
    await expect(assertOwnerTokenUsable(t.db, token, now, SECRET)).rejects.toMatchObject({ reason: "already_used" });
    await expect(markOwnerTokenUsed(t.db, outreachId)).rejects.toMatchObject({ reason: "already_used" });
  });

  it("valid signature but hash not stored => unknown_token", async () => {
    const other = createOwnerToken({ outreachId, expiresAt: new Date("2026-02-01T00:00:00Z") }, SECRET);
    await expect(assertOwnerTokenUsable(t.db, other.token, now, SECRET)).rejects.toMatchObject({
      reason: "unknown_token",
    });
  });
});
