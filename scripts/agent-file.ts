/** `pnpm agent:file CA [--report <id>]` - triggers the filing agent on the running dev server and follows it until paused/submitted. */
import { api, BASE, followRun } from "./agent-lib";

async function main() {
  const args = process.argv.slice(2);
  const state = args.find((a) => /^[A-Za-z]{2}$/.test(a))?.toUpperCase();
  const flag = args.indexOf("--report");
  let reportId = flag >= 0 ? args[flag + 1] : undefined;
  if (!reportId) {
    if (!state) throw new Error("Usage: pnpm agent:file <CA|DE|TX> [--report <id>]");
    const found = await api<{ id?: string; error?: string }>(`/api/agents/reports?state=${state}`);
    if (found.status !== 200 || !found.body.id) throw new Error(found.body.error ?? `No fileable ${state} report`);
    reportId = found.body.id;
  }
  console.log(`Filing agent -> ${BASE}  report ${reportId}`);
  const started = await api<{ runId?: string; error?: string }>("/api/agents/file", { method: "POST", body: JSON.stringify({ reportId, state }) });
  if (started.status !== 202 || !started.body.runId) throw new Error(`Could not start: ${started.status} ${started.body.error ?? ""}`);
  console.log(`Run ${started.body.runId} started`);
  const run = await followRun(started.body.runId, (r) => r.phase === "awaiting_approval");
  if (run.status === "failed") {
    console.error(`FAILED: ${run.error}`);
    process.exit(1);
  }
  if (run.phase === "awaiting_approval") {
    console.log("\nPaused at 'Approve submission'. Approve the report in Escheat Agent; the agent then submits. Following...\n");
    const done = await followRun(started.body.runId);
    if (done.status === "failed") {
      console.error(`FAILED: ${done.error}`);
      process.exit(1);
    }
    console.log(`\nSubmitted. Confirmation: ${String(done.output.confirmation)}`);
    return;
  }
  console.log(`\nDone (${run.status}).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
