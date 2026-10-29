import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { buildNaupaFile } from "./naupa-fixture";
import { parseNaupaUpload } from "./naupa-adapter";
import { parsePortal, PORTAL_SLUGS } from "./portals";
import { createClaim, ReplicaClaimError } from "./claims";
import {
  checkCredentials,
  createSessionToken,
  REPLICA_PASSWORD,
  REPLICA_USERNAME,
  SESSION_TTL_SECONDS,
  verifySessionToken,
} from "./session";
import { nameMatches, normalizeRecordFile, searchRecords, type SearchRecord } from "./search";
import {
  cancelReplicaSubmission,
  createSubmission,
  getSubmission,
  ReplicaSubmissionError,
  submitReplicaSubmission,
} from "./submissions";

const rec = (over: Partial<SearchRecord>): SearchRecord => ({
  propertyId: "X1",
  state: "tx",
  ownerName: "SOMEONE",
  city: "AUSTIN",
  reportedBy: "SYNTHETIC HOLDER",
  propertyType: "CK13",
  amountCents: 100,
  ...over,
});
const RECORDS: SearchRecord[] = [
  rec({ propertyId: "TX-1", ownerName: "NORTHWIND FIXTURES INC", amountCents: 118000 }),
  rec({ propertyId: "TX-2", ownerName: "BAYLINE ELECTRIC", city: "DALLAS" }),
  rec({ propertyId: "CA-1", state: "ca", ownerName: "BAYLINE ELECTRIC CO" }),
  rec({ propertyId: "DE-1", state: "de", ownerName: "ACME WIDGETS LLC" }),
];

describe("portal slugs", () => {
  it("accepts exactly the six portals", () => {
    expect(PORTAL_SLUGS).toHaveLength(6);
    for (const slug of PORTAL_SLUGS) expect(parsePortal(slug)).not.toBeNull();
    expect(parsePortal("tx-holder")).toMatchObject({ state: "tx", kind: "holder", stateCode: "TX" });
  });
  it("rejects anything else so the page can 404", () => {
    for (const bad of ["ny-holder", "ca", "ca-holder/x", "CA-HOLDER", "", "../ca-holder", undefined, 7]) {
      expect(parsePortal(bad)).toBeNull();
    }
  });
});

describe("session", () => {
  it("accepts only the demo credentials", () => {
    expect(checkCredentials({ username: REPLICA_USERNAME, password: REPLICA_PASSWORD })).toBe(true);
    expect(checkCredentials({ username: REPLICA_USERNAME, password: "nope" })).toBe(false);
    expect(checkCredentials({ username: "", password: "" })).toBe(false);
    expect(checkCredentials(null)).toBe(false);
  });
  it("round-trips a token", () => {
    const t = createSessionToken(REPLICA_USERNAME, "ca", 1_000_000);
    expect(verifySessionToken(t, 1_000_000)).toMatchObject({ u: REPLICA_USERNAME, st: "ca" });
  });
  it("rejects tampered payloads, tampered signatures and expired tokens", () => {
    const t = createSessionToken(REPLICA_USERNAME, "ca", 1_000_000);
    const [body, sig] = t.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ u: "admin", st: "tx", exp: 9_999_999_999 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${sig}`, 1_000_000)).toBeNull();
    expect(verifySessionToken(`${body}.${sig.replace(/.$/, sig.endsWith("0") ? "1" : "0")}`, 1_000_000)).toBeNull();
    expect(verifySessionToken(t, 1_000_000 + (SESSION_TTL_SECONDS + 1) * 1000)).toBeNull();
    expect(verifySessionToken("garbage")).toBeNull();
    expect(verifySessionToken(undefined)).toBeNull();
  });
});

describe("search matching", () => {
  it("is case, punctuation and suffix insensitive", () => {
    expect(nameMatches("northwind fixtures, inc.", "NORTHWIND FIXTURES INC")).toBe(true);
    expect(nameMatches("Northwind", "NORTHWIND FIXTURES INC")).toBe(true);
    expect(nameMatches("fixtures northwind", "NORTHWIND FIXTURES INC")).toBe(true);
    expect(nameMatches("Northwnd Fixtures", "NORTHWIND FIXTURES INC")).toBe(true);
    expect(nameMatches("Southwind", "NORTHWIND FIXTURES INC")).toBe(false);
  });
  it("finds the Northwind variant in TX and not in CA or DE", () => {
    expect(searchRecords("tx", { name: "Northwind Fixtures, Inc." }, RECORDS).map((r) => r.propertyId)).toEqual(["TX-1"]);
    expect(searchRecords("ca", { name: "Northwind Fixtures, Inc." }, RECORDS)).toEqual([]);
    expect(searchRecords("de", { name: "Northwind Fixtures, Inc." }, RECORDS)).toEqual([]);
  });
  it("filters by city and validates input", () => {
    expect(searchRecords("tx", { name: "bayline", city: "dallas" }, RECORDS)).toHaveLength(1);
    expect(searchRecords("tx", { name: "bayline", city: "austin" }, RECORDS)).toHaveLength(0);
    expect(() => searchRecords("tx", { name: "a" }, RECORDS)).toThrow();
  });
  it("normalizes fixture file shapes", () => {
    const out = normalizeRecordFile({ TX: [{ id: "T9", owner: "ZED", city: "X", amount: "$1,180.00" }] });
    expect(out).toEqual([expect.objectContaining({ state: "tx", propertyId: "T9", amountCents: 118000 })]);
  });
});

describe("naupa summary", () => {
  it("summarizes totals, count and per-code breakdown", () => {
    const s = parseNaupaUpload(buildNaupaFile());
    expect(s.problems).toEqual([]);
    expect(s).toMatchObject({
      holderName: "NORTHWIND FIXTURES INC",
      reportType: "R",
      itemCount: 3,
      totalCents: 234000 + 15050 + 9900,
    });
    expect(s.byPropertyCode).toEqual([
      { code: "CK13", count: 2, totalCents: 249050 },
      { code: "MS01", count: 1, totalCents: 9900 },
    ]);
  });
  it("reports blocking problems", () => {
    const bad = parseNaupaUpload(buildNaupaFile({ suminfoCents: 5 }));
    expect(bad.problems.some((p) => p.severity === "error")).toBe(true);
    expect(parseNaupaUpload("hello world").problems.some((p) => p.severity === "error")).toBe(true);
  });
});

describe("submission lifecycle", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("goes uploaded -> awaiting_approval -> submitted and cannot submit twice", async () => {
    const { submission } = await createSubmission(t.db, {
      state: "ca",
      holderLogin: REPLICA_USERNAME,
      fileName: "r.txt",
      content: buildNaupaFile(),
    });
    expect(submission.status).toBe("awaiting_approval");
    expect(submission.totalCents).toBe(258950);
    const done = await submitReplicaSubmission(submission.id, t.db);
    expect(done.status).toBe("submitted");
    expect(done.confirmationNumber).toMatch(/^REPL-CA-\d{4}-[A-Z0-9]{6}$/);
    await expect(submitReplicaSubmission(submission.id, t.db)).rejects.toMatchObject({ code: "already_submitted" });
    expect((await getSubmission(t.db, submission.id))?.confirmationNumber).toBe(done.confirmationNumber);
  });

  it("refuses files with errors and unknown ids, and handles cancel", async () => {
    const { submission } = await createSubmission(t.db, {
      state: "de",
      holderLogin: REPLICA_USERNAME,
      fileName: "bad.txt",
      content: buildNaupaFile({ suminfoCents: 1 }),
    });
    expect(submission.status).toBe("uploaded");
    await expect(submitReplicaSubmission(submission.id, t.db)).rejects.toBeInstanceOf(ReplicaSubmissionError);
    await expect(submitReplicaSubmission("00000000-0000-4000-8000-000000000000", t.db)).rejects.toMatchObject({
      code: "not_found",
    });
    const { submission: ok } = await createSubmission(t.db, {
      state: "de",
      holderLogin: REPLICA_USERNAME,
      fileName: "ok.txt",
      content: buildNaupaFile(),
    });
    expect((await cancelReplicaSubmission(ok.id, t.db)).status).toBe("rejected");
    await expect(submitReplicaSubmission(ok.id, t.db)).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("creates claims with the stored amount and rejects unknown properties", async () => {
    const claim = await createClaim(
      t.db,
      { state: "tx", propertyId: "TX-1", claimantName: "Northwind Fixtures, Inc.", contact: "ap@example.test" },
      RECORDS,
    );
    expect(claim.amountCents).toBe(118000);
    expect(claim.confirmationNumber).toMatch(/^REPL-CLM-TX-\d{4}-[A-Z0-9]{6}$/);
    await expect(
      createClaim(t.db, { state: "ca", propertyId: "TX-1", claimantName: "Nope Co", contact: "x@y.test" }, RECORDS),
    ).rejects.toBeInstanceOf(ReplicaClaimError);
  });
});

describe("shipped fixture (fixtures/replica/search-records.json)", () => {
  it("has the $1,180.00 Northwind variant in TX only", async () => {
    const { loadSearchRecords } = await import("./search");
    const records = loadSearchRecords();
    const hits = (st: "ca" | "de" | "tx") => searchRecords(st, { name: "Northwind Fixtures, Inc." }, records);
    expect(hits("tx").map((r) => r.amountCents)).toContain(118000);
    expect(hits("ca")).toEqual([]);
    expect(hits("de")).toEqual([]);
  });
});

describe("naupa adapter with the reports lane writer", () => {
  it("summarizes a file produced by buildNaupaReport", async () => {
    const { buildNaupaReport } = await import("@/lib/reports/naupa");
    const { buildInput } = await import("@/lib/reports/__fixtures__");
    const built = buildNaupaReport(buildInput("CA", "remit"));
    const s = parseNaupaUpload(built.file);
    expect(s.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(s.totalCents).toBe(built.totals.totalCents);
    expect(s.itemCount).toBe(built.totals.propertyRecordCount);
    expect(s.holderName).toBeTruthy();
  });
});
