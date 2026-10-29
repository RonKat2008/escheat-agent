import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, migrate } from "@/db/client";
import { reports } from "@/db/schema";
import { agentErrorResponse } from "@/lib/browser-agents/http";
import { sessionGuard } from "@/lib/auth/session";

const Query = z.object({ state: z.enum(["CA", "DE", "TX"]) });
const ById = z.object({ id: z.string().uuid() });

/** `?id=<reportId>` returns that report's filing status; `?state=CA` returns the latest fileable (validated / awaiting_approval / approved) report for a state, for the CLI. */
export async function GET(request: Request): Promise<NextResponse> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  try {
    const idParam = new URL(request.url).searchParams.get("id");
    if (idParam) {
      const { id } = ById.parse({ id: idParam });
      await migrate();
      const [r] = await (await getDb())
        .select({ id: reports.id, state: reports.state, status: reports.status, itemCount: reports.itemCount, totalCents: reports.totalCents, replicaConfirmation: reports.replicaConfirmation, submittedAt: reports.submittedAt })
        .from(reports)
        .where(eq(reports.id, id));
      return r ? NextResponse.json(r) : NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    const { state } = Query.parse({ state: new URL(request.url).searchParams.get("state")?.toUpperCase() });
    await migrate();
    const [row] = await (await getDb())
      .select({ id: reports.id, state: reports.state, status: reports.status, itemCount: reports.itemCount, totalCents: reports.totalCents, checksum: reports.checksum })
      .from(reports)
      .where(and(eq(reports.state, state), inArray(reports.status, ["validated", "awaiting_approval", "approved"])))
      .orderBy(desc(reports.createdAt))
      .limit(1);
    if (!row) return NextResponse.json({ error: `No fileable ${state} report.` }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    return agentErrorResponse(err);
  }
}
