import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { eq } from "drizzle-orm";
import { approvals, companies, ledgerItems, outreach, staleItems } from "@/db/schema";
import {
  assertOwnerTokenUsable,
  createOwnerToken,
  devFallbackSecret,
  isOwnerLinkLive,
  markOwnerTokenUsed,
  MIN_SECRET_LENGTH,
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

describe("ephemeral dev owner-link secret", () => {
  const withoutSecret = (nodeEnv: string, fn: () => void) => {
    vi.stubEnv("OWNER_LINK_SECRET", undefined);
    vi.stubEnv("NODE_ENV", nodeEnv);
    try {
      fn();
    } finally {
      vi.unstubAllEnvs();
    }
  };
  it("only exists under next dev: production and test stay fail-closed", () => {
    expect(devFallbackSecret("production")).toBeNull();
    expect(devFallbackSecret("test")).toBeNull();
    expect(devFallbackSecret(undefined)).toBeNull();
    const s = devFallbackSecret("development");
    expect(s).not.toBeNull();
    expect(s!.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH);
    expect(devFallbackSecret("development")).toBe(s); // stable for the life of the process so verify matches create
  });
  it("signs and verifies a link in development with no OWNER_LINK_SECRET", () => {
    withoutSecret("development", () => {
      const { token } = createOwnerToken({ outreachId: "o1", expiresAt: later });
      expect(verifyOwnerToken(token, now).outreachId).toBe("o1");
    });
  });
  it("still refuses to mint a link in production without the secret", () => {
    withoutSecret("production", () => {
      expect(() => createOwnerToken({ outreachId: "o", expiresAt: later })).toThrow(OwnerTokenConfigError);
    });
  });
  it("an explicitly empty secret stays an error even in development", () => {
    withoutSecret("development", () => {
      expect(() => createOwnerToken({ outreachId: "o", expiresAt: later }, "")).toThrow(OwnerTokenConfigError);
    });
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
    // R4-10: the link only works once the notice was approved and sent.
    await expect(assertOwnerTokenUsable(t.db, token, now, SECRET)).rejects.toMatchObject({ reason: "not_live" });
    const [ap] = await t.db.insert(approvals).values({ action: "send_email", subjectId: outreachId, payloadSha256: "0".repeat(64) }).returning();
    await t.db.update(outreach).set({ status: "sent", approvalId: ap!.id }).where(eq(outreach.id, outreachId));
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

describe("owner link gating (R4-10)", () => {
  let t: TestDb;
  let companyId: string;
  let staleItemId: string;
  beforeAll(async () => {
    t = await createTestDb();
    const [c] = await t.db.insert(companies).values({ name: "Northwind (SYNTHETIC)", incorporationState: "DE", hqState: "TX" }).returning();
    const [li] = await t.db
      .insert(ledgerItems)
      .values({ companyId: c!.id, payeeNameRaw: "Yarrowdale Supply", propertyType: "vendor_check", amountCents: 128_940, issueDate: "2025-01-01" })
      .returning();
    const [si] = await t.db
      .insert(staleItems)
      .values({ companyId: c!.id, ledgerItemId: li!.id, amountCents: 128_940, propertyType: "vendor_check", staleSince: "2025-07-01" })
      .returning();
    companyId = c!.id;
    staleItemId = si!.id;
  });
  afterAll(async () => {
    await t.close();
  });

  async function linkFor(values: Partial<typeof outreach.$inferInsert>, withApproval: boolean) {
    const [o] = await t.db.insert(outreach).values({ companyId, staleItemId, channel: "letter", ...values }).returning();
    const created = createOwnerToken({ outreachId: o!.id, expiresAt: later }, SECRET);
    let approvalId: string | null = null;
    if (withApproval) {
      const [ap] = await t.db.insert(approvals).values({ action: "mail_letter", subjectId: o!.id, payloadSha256: "0".repeat(64) }).returning();
      approvalId = ap!.id;
    }
    await t.db.update(outreach).set({ tokenHash: created.tokenHash, approvalId }).where(eq(outreach.id, o!.id));
    return { id: o!.id, token: created.token };
  }

  it.each(["draft", "awaiting_approval", "approved", "failed", "cancelled"] as const)("a %s notice has no working link", async (status) => {
    const { id, token } = await linkFor({ status }, status === "approved");
    await expect(assertOwnerTokenUsable(t.db, token, now, SECRET)).rejects.toMatchObject({ reason: "not_live" });
    await expect(markOwnerTokenUsed(t.db, id, now)).rejects.toMatchObject({ reason: "not_live" });
  });

  it("a sent row without an approval on record is not live either", async () => {
    const { token } = await linkFor({ status: "sent" }, false);
    await expect(assertOwnerTokenUsable(t.db, token, now, SECRET)).rejects.toMatchObject({ reason: "not_live" });
  });

  it.each([
    ["sent (Lob test mode)", { status: "sent" as const, offline: false }],
    ["sent offline", { status: "sent" as const, offline: true }],
    ["delivered", { status: "delivered" as const }],
  ])("an approved and %s notice has a working link", async (_label, values) => {
    const { id, token } = await linkFor(values, true);
    await expect(assertOwnerTokenUsable(t.db, token, now, SECRET)).resolves.toMatchObject({ outreachId: id });
  });

  it("a notice cancelled after the page loaded cannot take the reply", async () => {
    const { id, token } = await linkFor({ status: "sent" }, true);
    await assertOwnerTokenUsable(t.db, token, now, SECRET);
    await t.db.update(outreach).set({ status: "cancelled" }).where(eq(outreach.id, id));
    await expect(markOwnerTokenUsed(t.db, id, now)).rejects.toMatchObject({ reason: "not_live" });
  });

  it("isOwnerLinkLive matches the gate", () => {
    expect(isOwnerLinkLive({ status: "sent", approvalId: "a" })).toBe(true);
    expect(isOwnerLinkLive({ status: "delivered", approvalId: "a" })).toBe(true);
    expect(isOwnerLinkLive({ status: "approved", approvalId: "a" })).toBe(false);
    expect(isOwnerLinkLive({ status: "sent", approvalId: null })).toBe(false);
    expect(isOwnerLinkLive({ status: "responded", approvalId: "a" })).toBe(false);
  });
});
