/** Local demo prep for UI verification: advance the demo clock and recompute timelines. Usage: tsx scripts/ui-b-prep.ts <days> */
import { existsSync } from "node:fs";
import { closeDb, getDb, migrate } from "../src/db/client";
import { advanceClock } from "../src/lib/clock";
import { resolveCompanyId } from "../src/lib/pipeline/company";
import { recomputeTimelines } from "../src/lib/pipeline/recompute";
import { staleItems } from "../src/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  await migrate();
  const db = await getDb();
  const companyId = (await resolveCompanyId(db))!;
  const days = Number(process.argv[2] ?? 0);
  if (days) await advanceClock(db, companyId, days);
  const r = await recomputeTimelines(db, companyId);
  const rows = await db.select({ s: staleItems.status, st: staleItems.ownerState }).from(staleItems);
  const counts: Record<string, number> = {};
  for (const x of rows) counts[`${x.st}:${x.s}`] = (counts[`${x.st}:${x.s}`] ?? 0) + 1;
  console.log(r.today, JSON.stringify(counts));
}
main().then(() => closeDb()).catch(async (e) => { console.error(e); await closeDb().catch(() => undefined); process.exit(1); });
