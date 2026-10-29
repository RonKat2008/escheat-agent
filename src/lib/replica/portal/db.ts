import { getDb, migrate, type Db } from "@/db/client";

let ready: Promise<Db> | undefined;

/** Shared DB handle with migrations applied once per process. */
export function getPortalDb(): Promise<Db> {
  ready ??= migrate().then(() => getDb());
  ready.catch(() => {
    ready = undefined;
  });
  return ready;
}
