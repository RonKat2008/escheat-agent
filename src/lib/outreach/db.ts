import { getDb, migrate, type Db } from "@/db/client";

let ready: Promise<Db> | undefined;

/** Migrated singleton DB for route handlers and server actions. */
export function getOutreachDb(): Promise<Db> {
  ready ??= migrate().then(() => getDb());
  ready.catch(() => {
    ready = undefined;
  });
  return ready;
}
