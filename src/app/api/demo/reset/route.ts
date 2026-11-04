import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, migrate } from "@/db/client";
import { sessionGuard } from "@/lib/auth/session";
import { demoInvariantProblems, DemoResetBlockedError, demoResetBlocker, resetDemoData } from "@/lib/demo/reset";

const bodySchema = z.object({ confirm: z.literal(true) });

/** Whether a reset is allowed here, so the UI can disable the button with the reason. The server re-checks on POST. */
export async function GET(req: Request) {
  const denied = await sessionGuard(req);
  if (denied) return denied;
  const reason = demoResetBlocker();
  return NextResponse.json({ available: reason === null, reason });
}

/** Reseed the synthetic demo database in-process. Wipes approvals, filings and every other app row. */
export async function POST(req: Request) {
  const denied = await sessionGuard(req);
  if (denied) return denied;
  const reason = demoResetBlocker();
  if (reason) return NextResponse.json({ error: reason, code: "reset_unavailable" }, { status: 403 });
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (!bodySchema.safeParse(json).success) {
    return NextResponse.json({ error: 'Send {"confirm": true} to reset the demo data.', code: "not_confirmed" }, { status: 400 });
  }
  try {
    await migrate();
    const summary = await resetDemoData(await getDb());
    const problems = process.env.DEMO_ANCHOR_DATE === "2026-11-01" ? demoInvariantProblems(summary) : [];
    return NextResponse.json({ ok: true, ...summary, problems });
  } catch (e) {
    if (e instanceof DemoResetBlockedError) return NextResponse.json({ error: e.message, code: "reset_unavailable" }, { status: 409 });
    console.error("demo reset failed", e);
    return NextResponse.json({ error: "The reset failed. See the server log." }, { status: 500 });
  }
}
