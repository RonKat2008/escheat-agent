import { mkdirSync } from "node:fs";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type DbMode = "neon" | "pglite";

/** Default PGlite location; override with env PGLITE_DATA_DIR (e.g. one copy per dev server, since PGlite is single-process). */
export const PGLITE_DATA_DIR = ".data/pglite";
export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

interface DbHandle {
  mode: DbMode;
  db: Db;
  migrate: () => Promise<void>;
  close: () => Promise<void>;
}

let handlePromise: Promise<DbHandle> | undefined;

/** Which driver getDb() will use, decided from DATABASE_URL (read lazily). */
export function dbMode(): DbMode {
  return process.env.DATABASE_URL?.trim() ? "neon" : "pglite";
}

async function createNeonHandle(url: string): Promise<DbHandle> {
  const [{ Pool, neonConfig }, { drizzle }, { migrate }] = await Promise.all([
    import("@neondatabase/serverless"),
    import("drizzle-orm/neon-serverless"),
    import("drizzle-orm/neon-serverless/migrator"),
  ]);
  if (typeof WebSocket !== "undefined" && !neonConfig.webSocketConstructor) {
    neonConfig.webSocketConstructor = WebSocket;
  }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  return {
    mode: "neon",
    db,
    migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: () => pool.end(),
  };
}

async function createPgliteHandle(dataDir: string | undefined): Promise<DbHandle> {
  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  if (dataDir !== undefined) mkdirSync(path.dirname(dataDir), { recursive: true });
  const client = dataDir === undefined ? new PGlite() : new PGlite(dataDir);
  const db = drizzle(client, { schema });
  return {
    mode: "pglite",
    db,
    migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: () => client.close(),
  };
}

async function getHandle(): Promise<DbHandle> {
  if (!handlePromise) {
    const url = process.env.DATABASE_URL?.trim();
    handlePromise = url ? createNeonHandle(url) : createPgliteHandle(process.env.PGLITE_DATA_DIR?.trim() || PGLITE_DATA_DIR);
    handlePromise.catch(() => {
      handlePromise = undefined;
    });
  }
  return handlePromise;
}

/** Lazy singleton: Neon when DATABASE_URL is set, otherwise file-backed PGlite at .data/pglite. */
export async function getDb(): Promise<Db> {
  return (await getHandle()).db;
}

/** Apply drizzle/ migrations to whichever driver getDb() uses. */
export async function migrate(): Promise<DbMode> {
  const handle = await getHandle();
  await handle.migrate();
  return handle.mode;
}

/** Close the singleton (scripts and tests). Safe to call when never opened. */
export async function closeDb(): Promise<void> {
  if (!handlePromise) return;
  const handle = await handlePromise;
  handlePromise = undefined;
  await handle.close();
}

export interface TestDb {
  db: Db;
  close: () => Promise<void>;
}

/** Fresh in-memory PGlite with all migrations applied. Never touches DATABASE_URL. */
export async function createTestDb(): Promise<TestDb> {
  const handle = await createPgliteHandle(undefined);
  await handle.migrate();
  return { db: handle.db, close: handle.close };
}
