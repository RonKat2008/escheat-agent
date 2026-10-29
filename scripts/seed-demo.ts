/** Loads the SYNTHETIC demo company into the database (PGlite when no DATABASE_URL). Idempotent. */
import { closeDb, dbMode, getDb, migrate } from "../src/db/client";
import { buildBundle } from "../src/lib/synthetic/build";
import { seedDemo } from "../src/lib/synthetic/seed";

async function main() {
  const mode = await migrate();
  console.log(`Seeding SYNTHETIC demo data (${mode}${dbMode() === "pglite" ? ": .data/pglite" : ""})...`);
  const bundle = buildBundle();
  const db = await getDb();
  const counts = await seedDemo(db, bundle.dataset, [...bundle.generatedCases, ...bundle.adversarialCases]);
  console.log(
    Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(" "),
  );
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
