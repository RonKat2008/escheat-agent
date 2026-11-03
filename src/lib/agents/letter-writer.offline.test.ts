import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { agentRuns } from "@/db/schema";
import { setCassetteDir } from "@/lib/llm/cassette";
import { OfflineCassetteMissing } from "@/lib/llm/errors";
import { draftLetterVariables, LETTER_TEMPLATE_OFFLINE_LABEL } from "./letter-writer";
import type { ClassifierItem } from "./types";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
  setCassetteDir(mkdtempSync(path.join(os.tmpdir(), "empty-cassettes-")));
  vi.stubEnv("ESCHEAT_OFFLINE", "1");
  vi.stubEnv("ESCHEAT_RECORD", "");
});
afterEach(async () => {
  setCassetteDir(undefined);
  vi.unstubAllEnvs();
  await t.close();
});

describe("draftLetterVariables offline with no cassette", () => {
  it("logs a succeeded 'template (offline)' run with no developer error, then lets the caller fall back", async () => {
    const item = { description: "check" } as unknown as ClassifierItem;
    await expect(draftLetterVariables(item, { name: "A" }, { name: "H" }, { db: t.db })).rejects.toBeInstanceOf(OfflineCassetteMissing);
    const rows = await t.db.select().from(agentRuns);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe("succeeded");
    expect(row.model).toBe(LETTER_TEMPLATE_OFFLINE_LABEL);
    expect(row.error).toBeNull();
    expect(row.costUsdMicros).toBe(0);
    expect(JSON.stringify(row)).not.toContain("OfflineCassetteMissing");
  });
});
