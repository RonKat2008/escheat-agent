import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, migrate } from "@/db/client";
import { clockMutationAllowed, getOffsetDays, now } from "@/lib/clock";
import { diffDays, isIsoDate, type IsoDate } from "@/lib/dates";
import { outOfScopeOf } from "@/components/shell/clock-toast";
import { inScopeStates } from "@/lib/coverage-server";
import { moveDemoClock } from "@/lib/pipeline/clock-move";
import { resetDemoClock } from "@/lib/pipeline/clock-reset";
import { resolveCompanyId } from "@/lib/pipeline/company";
import { notifyClockAdvanced } from "@/lib/pipeline/notify";
import { sessionGuard } from "@/lib/auth/session";

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
  const denied = await sessionGuard(req);
  if (denied) return denied;
  await migrate();
  const db = await getDb();
  const companyId = await resolveCompanyId(db, new URL(req.url).searchParams.get("companyId"));
  if (!companyId) return NextResponse.json({ error: "No company. Run pnpm seed:demo." }, { status: 404 });
  return NextResponse.json({ companyId, ...(await state(companyId)) });
}

export async function POST(req: Request) {
  const denied = await sessionGuard(req);
  if (denied) return denied;
  if (!clockMutationAllowed()) {
    return NextResponse.json({ error: "The demo clock is disabled in production (set DEMO_MODE=1 to enable it)." }, { status: 403 });
  }
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
    // F17: Reset restores anchor-date statuses and removes letters auto-drafted after the anchor (not just the date).
    const reset = await resetDemoClock(db, companyId);
    const { today, offsetDays } = await state(companyId);
    const inngestNotified = await notifyClockAdvanced({ companyId, offsetDays, now: today });
    return NextResponse.json({
      companyId,
      today,
      offsetDays,
      transitions: reset.transitions,
      deadlinesMoved: 0,
      undetected: reset.undetected,
      reset: { restored: reset.restored, removedDrafts: reset.removedDrafts, keptHumanActions: reset.keptHumanActions, futureFilings: reset.futureFilings, futureRemittances: reset.futureRemittances },
      inngestNotified,
    });
  }

  // R8-01: one deterministic step (move, detect newly stale items, recompute), synchronous so the demo works without
  // the Inngest dev server, and so every page agrees on the liability as soon as this returns.
  const days = body.action === "advance" ? body.days : diffDays(await now(db, companyId), body.date as IsoDate);
  const result = await moveDemoClock(db, companyId, days);
  const { today, offsetDays } = await state(companyId);
  const inngestNotified = await notifyClockAdvanced({ companyId, offsetDays, now: today });
  return NextResponse.json({
    companyId,
    today,
    offsetDays,
    transitions: result.transitions,
    deadlinesMoved: result.deadlinesMoved,
    detected: { count: result.detected.count, cents: result.detected.cents, byState: result.detected.byState, outOfScope: outOfScopeOf(result.detected.byState, inScopeStates()) ?? undefined },
    undetected: result.undetected,
    inngestNotified,
  });
}
