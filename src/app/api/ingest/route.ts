import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { ingestCsv, IngestRequestSchema } from "@/lib/ingest/ingest";

export async function POST(request: Request): Promise<NextResponse> {
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
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err) {
    console.error("[ingest] failed", err);
    return NextResponse.json({ error: "Ingest failed" }, { status: 500 });
  }
}
