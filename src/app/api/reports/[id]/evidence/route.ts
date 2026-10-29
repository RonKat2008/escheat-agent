import { z } from "zod";
import { serviceErrorResponse } from "@/lib/b-http";
import { getOutreachDb } from "@/lib/outreach/db";
import { getReport, readEvidencePack } from "@/lib/reports/service";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(await ctx.params);
    const db = await getOutreachDb();
    const bytes = await readEvidencePack(db, id);
    const report = await getReport(db, id);
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
