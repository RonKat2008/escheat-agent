import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, migrate } from "@/db/client";
import { advanceClock, getOffsetDays, now, resetClock } from "@/lib/clock";
import { diffDays, isIsoDate, type IsoDate } from "@/lib/dates";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { notifyClockAdvanced } from "@/lib/pipeline/notify";
import { recomputeTimelines } from "@/lib/pipeline/recompute";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("advance"), days: z.number().int().min(-3650).max(3650), companyId: z.string().uuid().optional() }),
  z.object({ action: z.literal("reset"), companyId: z.string().uuid().optional() }),
  z.object({
    action: z.literal("advance_to"),
    date: z.string().refine(isIsoDate, "date must be YYYY-MM-DD"),
    companyId: z.string().uuid().optional(),
  }),
]);

async function state(companyId: string) {
  const db = await getDb();
  return { today: await now(db, companyId), offsetDays: await getOffsetDays(db, companyId) };
}

export async function GET(req: Request) {
  await migrate();
  const db = await getDb();
  const companyId = await resolveCompanyId(db, new URL(req.url).searchParams.get("companyId"));
  if (!companyId) return NextResponse.json({ error: "No company. Run pnpm seed:demo." }, { status: 404 });
  return NextResponse.json({ companyId, ...(await state(companyId)) });
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  await migrate();
  const db = await getDb();
  const body = parsed.data;
  const companyId = await resolveCompanyId(db, body.companyId);
  if (!companyId) return NextResponse.json({ error: "No company. Run pnpm seed:demo." }, { status: 404 });

  if (body.action === "reset") {
    await resetClock(db, companyId);
  } else if (body.action === "advance") {
    await advanceClock(db, companyId, body.days);
  } else {
    const today = await now(db, companyId);
    await advanceClock(db, companyId, diffDays(today, body.date as IsoDate));
  }

  // Synchronous so the demo works without the Inngest dev server.
  const result = await recomputeTimelines(db, companyId);
  const { today, offsetDays } = await state(companyId);
  const inngestNotified = await notifyClockAdvanced({ companyId, offsetDays, now: today });
  return NextResponse.json({
    companyId,
    today,
    offsetDays,
    transitions: result.transitions,
    deadlinesMoved: result.deadlinesMoved,
    inngestNotified,
  });
}
