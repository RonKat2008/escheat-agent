/** migrate -> sync rules -> detect stale items for the demo company -> print summary. */
import { closeDb, getDb, migrate } from "../src/db/client";
import { resolveCompanyId } from "../src/lib/pipeline/company";
import { detectStaleItems } from "../src/lib/pipeline/detect";
import { notifyStaleCreated } from "../src/lib/pipeline/notify";
import { syncRulesToDb } from "../src/lib/rules/load";
import * as clock from "../src/lib/clock";

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

async function main() {
  await migrate();
  const db = await getDb();
  const synced = await syncRulesToDb(db);
  console.log(`Rules synced: ${synced.map((s) => `${s.state}@${s.version}${s.verified ? "" : " (UNVERIFIED)"}`).join(", ")}`);
  const companyId = await resolveCompanyId(db);
  if (!companyId) throw new Error("No company found. Run `pnpm seed:demo` first.");
  const today = await clock.now(db, companyId);
  console.log(`Detecting stale items as of ${today}...`);
  const s = await detectStaleItems(db, companyId);
  console.log(
    JSON.stringify(
      {
        asOf: s.asOf,
        thresholdDays: s.thresholdDays,
        inserted: s.inserted,
        updated: s.updated,
        staleItems: s.inserted + s.updated,
        total: usd(s.totalCents),
        byState: s.byState,
        needsReview: s.needsReview,
        needsRule: s.needsRule,
        skippedNotStale: s.skippedNotStale,
        ambiguous: s.ambiguous.length,
        classificationMethods: s.methods,
      },
      null,
      2,
    ),
  );
  if (s.ambiguous.length) console.log("Ambiguous reconciliation items (not inserted):", s.ambiguous);
  if (s.newItemIds.length) {
    const { staleItems } = await import("../src/db/schema");
    const { inArray } = await import("drizzle-orm");
    const rows = await db.select().from(staleItems).where(inArray(staleItems.id, s.newItemIds));
    await notifyStaleCreated(rows.map((r) => ({ staleItemId: r.id, companyId, ownerState: r.ownerState })));
  }
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
