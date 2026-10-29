import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, type Db } from "@/db/client";
import { companies } from "@/db/schema";
import { IntegrationError, NotConfiguredError } from "./errors";

/** Map integration errors to JSON responses. NotConfigured -> 501 { error }. */
export function errorResponse(err: unknown, tag: string): NextResponse {
  if (err instanceof NotConfiguredError) return NextResponse.json({ error: err.message }, { status: 501 });
  if (err instanceof IntegrationError) {
    const status = err.status === 409 || err.status === 401 ? err.status : 502;
    return NextResponse.json({ error: err.message }, { status });
  }
  console.error(`[integrations:${tag}]`, err);
  return NextResponse.json({ error: "Integration request failed" }, { status: 500 });
}

const CompanyIdSchema = z.uuid();

/** Requested company if it exists, else the oldest company. Undefined when none exist. */
export async function resolveCompanyId(db: Db, requested?: string | null): Promise<string | undefined> {
  if (requested) {
    if (!CompanyIdSchema.safeParse(requested).success) return undefined;
    const [c] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, requested));
    return c?.id;
  }
  const [first] = await db.select({ id: companies.id }).from(companies).orderBy(asc(companies.createdAt)).limit(1);
  return first?.id;
}

/** Shared by POST routes: optional JSON `{ companyId? }` body. */
export async function companyFromRequest(
  request: Request,
): Promise<{ db: Db; companyId: string; body: Record<string, unknown> } | NextResponse> {
  let body: Record<string, unknown> = {};
  const text = await request.text();
  if (text.trim() !== "") {
    try {
      const j: unknown = JSON.parse(text);
      if (j && typeof j === "object" && !Array.isArray(j)) body = j as Record<string, unknown>;
      else return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
    } catch {
      return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
    }
  }
  const db = await getDb();
  const requested = typeof body.companyId === "string" ? body.companyId : undefined;
  const companyId = await resolveCompanyId(db, requested);
  if (!companyId) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  return { db, companyId, body };
}
