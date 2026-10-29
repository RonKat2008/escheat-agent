import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApprovalRequiredError } from "@/lib/approvals";
import { RecoveryServiceError } from "@/lib/recoveries/service";
import { ReportServiceError } from "@/lib/reports/service";

const STATUS: Record<string, number> = {
  no_rules: 422,
  no_items: 409,
  not_found: 404,
  not_approvable: 409,
  no_file: 404,
};

/** Maps service errors to { error, code } JSON with stable status codes. */
export function serviceErrorResponse(err: unknown): NextResponse {
  if (err instanceof ZodError) {
    return NextResponse.json({ error: "Invalid request", issues: err.issues.map((i) => ({ path: i.path, message: i.message })) }, { status: 400 });
  }
  if (err instanceof ReportServiceError || err instanceof RecoveryServiceError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: STATUS[err.code] ?? 400 });
  }
  if (err instanceof ApprovalRequiredError) {
    return NextResponse.json({ error: err.message, code: "approval_required" }, { status: 403 });
  }
  console.error("[api] unexpected error", err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
