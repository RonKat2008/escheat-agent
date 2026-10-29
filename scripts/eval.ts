/** `pnpm eval` — see src/lib/agents/eval-run.ts. */
import { closeDb } from "../src/db/client";
import { runEval } from "../src/lib/agents/eval-run";

runEval()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
