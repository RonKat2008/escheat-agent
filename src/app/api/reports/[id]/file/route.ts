import { z } from "zod";
import { serviceErrorResponse } from "@/lib/b-http";
import { getOutreachDb } from "@/lib/outreach/db";
import { readReportFile } from "@/lib/reports/service";
import { sessionGuard } from "@/lib/auth/session";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const denied = await sessionGuard(request);
  if (denied) return denied;
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(await ctx.params);
    const { report, text } = await readReportFile(await getOutreachDb(), id);
    return new Response(text, {
      headers: {
        "content-type": "text/plain; charset=iso-8859-1",
        "content-disposition": `attachment; filename="naupa-${report.state}-${report.reportYear}.txt"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
