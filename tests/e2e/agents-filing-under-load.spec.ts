import { expect, test, type APIRequestContext } from "playwright/test";
import { approveReportApi } from "./approver";

/**
 * R9-01: the filing agent, the replica portal and the app share one Next process and one PGlite database. In round 9
 * a filing stalled for 9-12 minutes and then failed while the runner page polled the server; with no other traffic the
 * same filing took 4 s. This spec files a report while GET /api/close-out/runner is polled every 2 s (what the runner
 * page and a watching person do) and requires the receipt within 45 s. The approval gate is checked on the way.
 *
 * CI-robust: the agents server's database is shared with agents.spec.ts (which may already have filed CA), so the spec
 * takes the first state that still produces a validated report instead of assuming fresh-seed constants.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(150_000);

const FILING_BUDGET_MS = 45_000;
const POLL_EVERY_MS = 2_000;
const STATES = ["TX", "CA", "DE"] as const;

interface Generated {
  reportId: string;
  status: string;
  checksum: string;
}
interface RunView {
  status: "running" | "succeeded" | "failed" | "cancelled";
  error: string | null;
  output: Record<string, unknown>;
}

async function validatedReport(request: APIRequestContext): Promise<{ state: string; report: Generated }> {
  const tried: string[] = [];
  for (const state of STATES) {
    const res = await request.post("/api/reports", { data: { state } });
    const body = (await res.json()) as Partial<Generated> & { error?: string };
    tried.push(`${state}: ${res.status()} ${body.status ?? body.error ?? ""}`);
    if (res.status() === 201 && body.status === "validated" && body.reportId && body.checksum) {
      return { state, report: body as Generated };
    }
  }
  throw new Error(`No state produced a validated report to file (${tried.join("; ")}).`);
}

test("R9-01: the filing agent files within 45 s while the runner is polled every 2 s; the approval gate still holds", async ({ request }) => {
  const { state, report } = await validatedReport(request);

  // The gate is server-enforced: no approval, no run (and no browser).
  const refused = await request.post("/api/agents/file", { data: { reportId: report.reportId } });
  expect(refused.status(), await refused.text()).toBe(409);
  expect(((await refused.json()) as { code?: string }).code).toBe("approval_required");

  const approved = await approveReportApi(request, report.reportId, report.checksum, "e2e-load-reviewer");
  expect(approved.status(), await approved.text()).toBe(201);

  // The load: the runner GET every 2 s for the whole run, without waiting for the previous one (a person's page
  // and a script both keep asking). Every response is timed.
  let polling = true;
  const pollMs: number[] = [];
  const pollStatuses = new Set<number>();
  const inFlight = new Set<Promise<void>>();
  const poller = (async () => {
    while (polling) {
      const startedAt = Date.now();
      const p = request
        .get(`/api/close-out/runner?state=${state}`, { timeout: 120_000 })
        .then((r) => {
          pollStatuses.add(r.status());
          pollMs.push(Date.now() - startedAt);
        })
        .catch(() => void pollStatuses.add(0))
        .finally(() => inFlight.delete(p));
      inFlight.add(p);
      await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
    }
  })();

  const started = Date.now();
  const start = await request.post("/api/agents/file", { data: { reportId: report.reportId } });
  expect(start.status(), await start.text()).toBe(202);
  const { runId } = (await start.json()) as { runId: string };

  let run: RunView | undefined;
  try {
    await expect
      .poll(
        async () => {
          run = (await (await request.get(`/api/agents/runs/${runId}`)).json()) as RunView;
          return run.status;
        },
        { timeout: FILING_BUDGET_MS, intervals: [500, 1000] },
      )
      .not.toBe("running");
  } finally {
    polling = false;
    await poller;
    await Promise.all([...inFlight]);
  }
  const elapsed = Date.now() - started;
  test.info().annotations.push({
    type: "timing",
    description: `${state} filed in ${(elapsed / 1000).toFixed(1)} s; ${pollMs.length} runner GETs, slowest ${Math.max(0, ...pollMs)} ms`,
  });

  expect(run?.error ?? null).toBeNull();
  expect(run?.status).toBe("succeeded");
  expect(elapsed).toBeLessThan(FILING_BUDGET_MS);
  expect(String(run?.output.confirmation)).toMatch(new RegExp(`^REPL-${state}-\\d{4}-[A-Z0-9]+$`));
  const final = (await (await request.get(`/api/agents/reports?id=${report.reportId}`)).json()) as { status: string; replicaConfirmation: string };
  expect(final).toMatchObject({ status: "submitted", replicaConfirmation: run?.output.confirmation });

  // The runner kept answering during the run, and it was actually polled (not a quiet server).
  expect(pollMs.length).toBeGreaterThan(0);
  expect([...pollStatuses]).toEqual([200]);
  expect(Math.max(...pollMs)).toBeLessThan(FILING_BUDGET_MS);

  // The approval was single-use: filing the same report again is refused.
  const again = await request.post("/api/agents/file", { data: { reportId: report.reportId } });
  expect(again.status()).toBeGreaterThanOrEqual(400);
});
