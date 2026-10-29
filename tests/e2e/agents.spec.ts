import { expect, test, type APIRequestContext } from "playwright/test";

/**
 * Browser-agent E2E against a running dev server (see scripts/agent-e2e.sh, which seeds an isolated PGlite
 * copy, starts `next dev` with matching APP_BASE_URL, and runs this file). Agents run in scripted mode
 * unless ANTHROPIC_API_KEY is set. Specs run serially: they share one database and one report.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

interface RunView {
  status: "running" | "succeeded" | "failed" | "cancelled";
  phase: string | null;
  mode: string | null;
  error: string | null;
  trace: { kind: string; message: string; screenshot?: string }[];
  output: Record<string, unknown>;
}

async function pollRun(request: APIRequestContext, runId: string, until: (r: RunView) => boolean): Promise<RunView> {
  let last: RunView | undefined;
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/agents/runs/${runId}`);
        last = (await res.json()) as RunView;
        return until(last) || last.status === "failed";
      },
      { timeout: 120_000, intervals: [500, 1000, 1000, 2000] },
    )
    .toBe(true);
  return last!;
}

let reportId = "";
let reportChecksum = "";
let runId = "";

test("filing agent pauses at Approve submission, files only after human approval", async ({ request }) => {
  const gen = await request.post("/api/reports", { data: { state: "CA" } });
  expect(gen.status(), await gen.text()).toBe(201);
  const report = (await gen.json()) as { reportId: string; status: string; itemCount: number; totalCents: number; checksum: string };
  expect(report.status).toBe("validated");
  reportId = report.reportId;
  reportChecksum = report.checksum;

  const start = await request.post("/api/agents/file", { data: { reportId } });
  expect(start.status(), await start.text()).toBe(202);
  runId = ((await start.json()) as { runId: string }).runId;

  // A second filing run for the same report is refused while one is active.
  const dup = await request.post("/api/agents/file", { data: { reportId } });
  expect(dup.status()).toBe(409);

  const paused = await pollRun(request, runId, (r) => r.phase === "awaiting_approval");
  expect(paused.error).toBeNull();
  expect(paused.status).toBe("running");
  expect(paused.mode).toBe(process.env.ANTHROPIC_API_KEY ? "stagehand" : "scripted");
  expect(paused.trace.some((s) => s.message.startsWith("Paused at 'Approve submission'"))).toBe(true);
  if (!process.env.ANTHROPIC_API_KEY) expect(paused.trace[0]!.message).toContain("SCRIPTED - no model configured");

  // Give the agent a few polling cycles: it must NOT submit on its own.
  await new Promise((r) => setTimeout(r, 5_000));
  const still = (await (await request.get(`/api/agents/runs/${runId}`)).json()) as RunView;
  expect(still.status).toBe("running");
  expect(still.output.confirmation).toBeUndefined();
  const mid = (await (await request.get(`/api/agents/reports?id=${reportId}`)).json()) as { status: string };
  expect(mid.status).toBe("awaiting_approval");
});

test("human approval releases the agent; confirmation number is stored", async ({ request }) => {
  const approve = await request.post(`/api/reports/${reportId}/approve`, { data: { approvedBy: "e2e-reviewer", expectedChecksum: reportChecksum } });
  expect(approve.status(), await approve.text()).toBe(201);

  const done = await pollRun(request, runId, (r) => r.status !== "running");
  expect(done.error).toBeNull();
  expect(done.status).toBe("succeeded");
  const confirmation = String(done.output.confirmation);
  expect(confirmation).toMatch(/^REPL-CA-\d{4}-[A-Z0-9]{6}$/);
  expect(done.output.video, "video recorded").toBeTruthy();
  expect((done.output.screenshots as string[]).length).toBeGreaterThanOrEqual(4);

  const final = (await (await request.get(`/api/agents/reports?id=${reportId}`)).json()) as { status: string; replicaConfirmation: string };
  expect(final.status).toBe("submitted");
  expect(final.replicaConfirmation).toBe(confirmation);
});

test("recovery agent finds the $1,180 Northwind record; claim needs approval, then files", async ({ request }) => {
  const start = await request.post("/api/agents/recover", { data: {} });
  expect(start.status(), await start.text()).toBe(202);
  const rid = ((await start.json()) as { runId: string }).runId;
  const done = await pollRun(request, rid, (r) => r.status !== "running");
  expect(done.error).toBeNull();
  expect(done.status).toBe("succeeded");
  const created = done.output.created as { id: string; state: string; amountCents: number; payloadSha256: string }[];
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({ state: "TX", amountCents: 118_000 });
  const recoveryId = created[0]!.id;

  // Re-running is idempotent.
  const again = await request.post("/api/agents/recover", { data: {} });
  const rerun = await pollRun(request, ((await again.json()) as { runId: string }).runId, (r) => r.status !== "running");
  expect(rerun.output.created).toEqual([]);
  expect(rerun.output.alreadyKnown).toBe(1);

  // No approval yet: the claim agent refuses.
  const refused = await request.post(`/api/agents/claim/${recoveryId}`);
  expect(refused.status()).toBe(409);

  const approve = await request.post(`/api/recoveries/${recoveryId}/approve`, {
    data: { approvedBy: "e2e-reviewer", expectedPayloadSha256: created[0]!.payloadSha256 },
  });
  expect(approve.status(), await approve.text()).toBeLessThan(300);
  const claim = await request.post(`/api/agents/claim/${recoveryId}`);
  expect(claim.status(), await claim.text()).toBe(202);
  const claimRun = await pollRun(request, ((await claim.json()) as { runId: string }).runId, (r) => r.status !== "running");
  expect(claimRun.error).toBeNull();
  expect(String(claimRun.output.confirmation)).toMatch(/^REPL-CLM-TX-\d{4}-[A-Z0-9]{6}$/);
});
