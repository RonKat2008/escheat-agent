import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { replicaFilingUrl } from "./filing-url";
import { filedDay } from "./portal/demo-date";
import { buildNaupaFile } from "./portal/naupa-fixture";
import { REPLICA_USERNAME } from "./portal/session";
import { createSubmission, listFiledSubmissions, submitReplicaSubmission } from "./portal/submissions";

describe("replicaFilingUrl", () => {
  it("links a replica confirmation to its state's holder dashboard", () => {
    expect(replicaFilingUrl("TX", "REPL-TX-2026-BXHNZE")).toBe("/replica/tx-holder/dashboard?filed=REPL-TX-2026-BXHNZE#filed-reports");
    expect(replicaFilingUrl("ca", "REPL-CA-2029-K7QX2M")).toMatch(/^\/replica\/ca-holder\/dashboard\?filed=/);
  });
  it("returns null for other states, claims, malformed numbers and state mismatches", () => {
    expect(replicaFilingUrl("NY", "REPL-NY-2026-ABCDEF")).toBeNull();
    expect(replicaFilingUrl("TX", "REPL-CLM-TX-2026-ABCDEF")).toBeNull();
    expect(replicaFilingUrl("TX", "../evil")).toBeNull();
    expect(replicaFilingUrl("TX", "REPL-CA-2026-ABCDEF")).toBeNull();
  });
});

describe("filedDay", () => {
  it("prefers the stored demo date", () => {
    expect(filedDay({ submittedAt: new Date("2026-11-04T04:00:00Z"), parsedSummary: { filedOn: "2029-03-30" } }, "2029-03-30")).toBe("2029-03-30");
  });
  it("clamps a real-clock timestamp that is ahead of the demo date", () => {
    expect(filedDay({ submittedAt: new Date("2026-11-04T04:00:00Z"), parsedSummary: null }, "2026-11-01")).toBe("2026-11-01");
  });
});

describe("filed reports list", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("lists only submitted reports for the state, newest first, with the filed day recorded", async () => {
    const make = (state: "ca" | "tx") => createSubmission(t.db, { state, holderLogin: REPLICA_USERNAME, fileName: "r.txt", content: buildNaupaFile() });
    const a = await make("tx");
    const b = await make("tx");
    await make("tx"); // never submitted
    const other = await make("ca");
    await submitReplicaSubmission(a.submission.id, t.db);
    const second = await submitReplicaSubmission(b.submission.id, t.db);
    await submitReplicaSubmission(other.submission.id, t.db);
    const rows = await listFiledSubmissions(t.db, "tx");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe(second.id);
    expect(rows.every((r) => r.state === "tx" && r.status === "submitted")).toBe(true);
    expect(rows[0]!.itemCount).toBe(3);
    expect(typeof rows[0]!.parsedSummary?.filedOn).toBe("string");
  });
});
