import { closeDb, dbMode, migrate } from "../src/db/client";

async function main() {
  const mode = dbMode();
  console.log(`Applying migrations (${mode}${mode === "pglite" ? ": .data/pglite" : ""})...`);
  await migrate();
  console.log("Migrations applied.");
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
