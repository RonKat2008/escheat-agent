import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getOutreachDb } from "@/lib/outreach/db";
import { applyLobEvent, verifyLobSignature } from "@/lib/outreach/webhooks";

export async function POST(request: Request): Promise<NextResponse> {
  const secret = getEnv().LOB_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "lob webhook not configured" }, { status: 501 });
  const rawBody = await request.text(); // raw body: the signature covers exact bytes
  const verdict = verifyLobSignature({
    rawBody,
    signature: request.headers.get("lob-signature"),
    timestamp: request.headers.get("lob-signature-timestamp"),
    secret,
  });
  if (!verdict.ok) return NextResponse.json({ error: `invalid signature (${verdict.reason})` }, { status: 401 });
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  if (typeof event !== "object" || event === null) return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  try {
    const result = await applyLobEvent(await getOutreachDb(), event);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[lob webhook] failed", err);
    return NextResponse.json({ error: "Webhook handling failed" }, { status: 500 });
  }
}
