import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companies } from "@/db/schema";

/** Explicit id, else the oldest company (the demo has exactly one: Northwind Fixtures, Inc.). */
export async function resolveCompanyId(db: Db, explicit?: string | null): Promise<string | null> {
  if (explicit) {
    const [row] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, explicit));
    return row?.id ?? null;
  }
  const [row] = await db.select({ id: companies.id }).from(companies).orderBy(asc(companies.createdAt)).limit(1);
  return row?.id ?? null;
}
