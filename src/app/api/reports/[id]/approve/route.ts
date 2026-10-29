import { NextResponse } from "next/server";
import { z } from "zod";
import { serviceErrorResponse } from "@/lib/b-http";
import { getOutreachDb } from "@/lib/outreach/db";
import { approveReport } from "@/lib/reports/service";

const Body = z.object({ approvedBy: z.string().trim().min(1).max(200) });

/** Records the submit_report approval bound to the file checksum. Does NOT file anything. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { id } = z.object({ id: z.string().uuid() }).parse(await ctx.params);
    const body = Body.parse(await request.json().catch(() => ({})));
    const report = await approveReport(await getOutreachDb(), id, body.approvedBy);
    return NextResponse.json({ reportId: report.id, status: report.status, approvalId: report.approvalId }, { status: 201 });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
