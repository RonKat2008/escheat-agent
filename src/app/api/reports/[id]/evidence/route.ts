import { z } from "zod";
import { serviceErrorResponse } from "@/lib/b-http";
import { getOutreachDb } from "@/lib/outreach/db";
import { loadEvidenceFiling } from "@/lib/reports/evidence-filing";
import { getReport, readEvidencePack, ReportServiceError } from "@/lib/reports/service";
import { sessionGuard } from "@/lib/auth/session";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(await ctx.params);
    const db = await getOutreachDb();
    const report = await getReport(db, id);
    if (!report) throw new ReportServiceError("not_found", `Report ${id} not found`);
    const filing = await loadEvidenceFiling(db, report);
    const bytes = await readEvidencePack(db, id, { filing });
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="evidence-${report?.state ?? "report"}-${report?.reportYear ?? ""}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
