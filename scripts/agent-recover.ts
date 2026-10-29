/** `pnpm agent:recover` - triggers the recovery agent on the running dev server and prints what it found. */
import { api, BASE, followRun } from "./agent-lib";

async function main() {
  console.log(`Recovery agent -> ${BASE}`);
  const started = await api<{ runId?: string; error?: string }>("/api/agents/recover", { method: "POST", body: "{}" });
  if (started.status !== 202 || !started.body.runId) throw new Error(`Could not start: ${started.status} ${started.body.error ?? ""}`);
  console.log(`Run ${started.body.runId} started`);
  const run = await followRun(started.body.runId);
  if (run.status === "failed") {
    console.error(`FAILED: ${run.error}`);
    process.exit(1);
  }
  const created = (run.output.created ?? []) as { state: string; amountCents: number; id: string }[];
  console.log(`\nFound ${created.length} new recovery(ies):`);
  for (const c of created) console.log(`  ${c.state} $${(c.amountCents / 100).toFixed(2)}  recovery ${c.id}  (claim drafted, awaiting human approval)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
