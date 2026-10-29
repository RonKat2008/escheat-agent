import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // Only used by drizzle-kit commands that connect (push/studio). Generation needs no DB.
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost:5432/escheat" },
});
