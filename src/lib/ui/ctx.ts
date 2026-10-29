import { connection } from "next/server";
import { getDb } from "@/db/client";
import { getDefaultCompanyId } from "@/lib/queries";

/** Db + the demo company for server components. Call inside a Suspense boundary (cacheComponents). */
export async function getCtx() {
  await connection(); // DB reads are request-time work, never prerendered
  const db = await getDb();
  const companyId = await getDefaultCompanyId(db);
  return { db, companyId };
}
