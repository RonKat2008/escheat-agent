import { closeDb, dbMode, migrate, PGLITE_DATA_DIR } from "../src/db/client";

async function main() {
  const mode = dbMode();
  console.log(`Applying migrations (${mode}${mode === "pglite" ? `: ${process.env.PGLITE_DATA_DIR?.trim() || PGLITE_DATA_DIR}` : ""})...`);
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
