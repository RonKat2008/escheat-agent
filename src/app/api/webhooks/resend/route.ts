import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { getEnv } from "@/lib/env";
import { getOutreachDb } from "@/lib/outreach/db";
import { applyResendEvent } from "@/lib/outreach/webhooks";

export async function POST(request: Request): Promise<NextResponse> {
  const secret = getEnv().RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "resend webhook not configured" }, { status: 501 });
  const payload = await request.text(); // raw body for svix
  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "missing svix headers" }, { status: 401 });
  }
  try {
    // svix itself rejects timestamps outside a 5 minute window
    new Webhook(secret).verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let event: unknown;
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  try {
    const result = await applyResendEvent(await getOutreachDb(), event as Parameters<typeof applyResendEvent>[1], svixId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[resend webhook] failed", err);
    return NextResponse.json({ error: "Webhook handling failed" }, { status: 500 });
  }
}
