import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { ingestCsv, IngestRequestSchema } from "@/lib/ingest/ingest";
import { sessionGuard } from "@/lib/auth/session";

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const body = IngestRequestSchema.safeParse(json);
  if (!body.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: body.error.issues.map((i) => ({ path: i.path, message: i.message })) },
      { status: 400 },
    );
  }
  try {
    const outcome = await ingestCsv(await getDb(), body.data);
    if (outcome.status === 200 && "inserted" in outcome.body && outcome.body.inserted > 0) {
      // Cached pages (Cache Components) must not keep showing the pre-import items.
      try {
        for (const p of ["/items", "/dashboard", "/approvals"]) revalidatePath(p);
      } catch {
        // outside a Next request scope (unit tests): nothing to revalidate
      }
    }
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err) {
    console.error("[ingest] failed", err);
    return NextResponse.json({ error: "Ingest failed" }, { status: 500 });
  }
}
