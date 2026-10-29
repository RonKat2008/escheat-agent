import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { consumeLoginAttempt, resetLoginLimiter, stepBucket } from "./login-limiter";

const now = 1_800_000_000_000;

describe("login rate limit (DB-backed, M8)", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetLoginLimiter(t.db);
  });

  it("allows a burst of 5 then blocks with retryAfter, per key, and refills over time", async () => {
    for (let i = 0; i < 5; i++) expect((await consumeLoginAttempt(t.db, "1.2.3.4", now)).ok).toBe(true);
    const blocked = await consumeLoginAttempt(t.db, "1.2.3.4", now);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect((await consumeLoginAttempt(t.db, "5.6.7.8", now)).ok).toBe(true);
    expect((await consumeLoginAttempt(t.db, "1.2.3.4", now + 15_000)).ok).toBe(true);
  });

  it("state lives in the DB, so a second limiter instance over the same DB sees the same attempts", async () => {
    for (let i = 0; i < 5; i++) await consumeLoginAttempt(t.db, "9.9.9.9", now);
    expect((await consumeLoginAttempt(t.db, "9.9.9.9", now)).ok).toBe(false);
  });

  it("serializes concurrent attempts on one key", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => consumeLoginAttempt(t.db, "7.7.7.7", now)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
  });

  it("stepBucket caps refill at the burst size", () => {
    expect(stepBucket({ tokens: 0, at: now }, now + 10 * 60_000).tokens).toBe(4);
  });
});
