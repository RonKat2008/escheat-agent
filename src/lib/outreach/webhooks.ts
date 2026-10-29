import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach } from "@/db/schema";
import { hmacSha256Hex, timingSafeEqual } from "@/lib/crypto";
import { appendEvent, type Tracking } from "./util";

export const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

export type LobVerifyResult = { ok: true } | { ok: false; reason: "missing_headers" | "bad_timestamp" | "stale_timestamp" | "bad_signature" };

/**
 * Lob: signature = hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`)). Raw body, constant-time compare.
 * The timestamp unit is undocumented; values above 1e12 are treated as milliseconds, otherwise seconds.
 */
export function verifyLobSignature(args: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  secret: string;
  now?: Date;
  toleranceMs?: number;
}): LobVerifyResult {
  if (!args.signature || !args.timestamp) return { ok: false, reason: "missing_headers" };
  const ts = Number(args.timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return { ok: false, reason: "bad_timestamp" };
  const tsMs = ts > 1e12 ? ts : ts * 1000;
  const nowMs = (args.now ?? new Date()).getTime();
  if (Math.abs(nowMs - tsMs) > (args.toleranceMs ?? WEBHOOK_TOLERANCE_MS)) return { ok: false, reason: "stale_timestamp" };
  const expected = hmacSha256Hex(args.secret, `${args.timestamp}.${args.rawBody}`);
  return timingSafeEqual(args.signature.trim().toLowerCase(), expected) ? { ok: true } : { ok: false, reason: "bad_signature" };
}

interface LobEvent {
  id?: string;
  event_type?: { id?: string } | string;
  date_created?: string;
  body?: { id?: string };
  reference_id?: string;
}

export interface WebhookApplyResult {
  matched: boolean;
  duplicate?: boolean;
  outreachId?: string;
}

/** Append a Lob event to the matching letter's tracking (idempotent on event id). */
export async function applyLobEvent(db: Db, event: LobEvent, receivedAt: Date = new Date()): Promise<WebhookApplyResult> {
  const letterId = event.body?.id ?? event.reference_id;
  if (!letterId) return { matched: false };
  const [row] = await db.select().from(outreach).where(eq(outreach.providerId, letterId));
  if (!row) return { matched: false };
  const type = typeof event.event_type === "string" ? event.event_type : (event.event_type?.id ?? "unknown");
  const prior = Array.isArray(row.tracking?.events) ? (row.tracking.events as Tracking[]) : [];
  if (event.id && prior.some((e) => e.id === event.id && e.source === "lob")) {
    return { matched: true, duplicate: true, outreachId: row.id };
  }
  const tracking = appendEvent(row.tracking, { source: "lob", id: event.id ?? null, type, at: event.date_created ?? null, receivedAt: receivedAt.toISOString() });
  const delivered = type === "letter.delivered" && (row.status === "sent" || row.status === "delivered");
  await db
    .update(outreach)
    .set({ tracking, ...(delivered ? { status: "delivered" as const } : {}) })
    .where(eq(outreach.id, row.id));
  return { matched: true, outreachId: row.id };
}

interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: { email_id?: string; bounce?: { message?: string } };
}

/** delivered / bounced / failed / complained etc. -> outreach.tracking (+ status for delivered/bounced). */
export async function applyResendEvent(
  db: Db,
  event: ResendEvent,
  svixId: string | null,
  receivedAt: Date = new Date(),
): Promise<WebhookApplyResult> {
  const emailId = event?.data?.email_id;
  if (!emailId) return { matched: false };
  const [row] = await db.select().from(outreach).where(eq(outreach.providerId, emailId));
  if (!row) return { matched: false };
  const prior = Array.isArray(row.tracking?.events) ? (row.tracking.events as Tracking[]) : [];
  if (svixId && prior.some((e) => e.id === svixId && e.source === "resend")) {
    return { matched: true, duplicate: true, outreachId: row.id };
  }
  const type = event.type ?? "unknown";
  const tracking = appendEvent(row.tracking, {
    source: "resend",
    id: svixId,
    type,
    at: event.created_at ?? null,
    detail: event.data?.bounce?.message ?? null,
    receivedAt: receivedAt.toISOString(),
  });
  const next =
    type === "email.delivered" && row.status === "sent"
      ? ("delivered" as const)
      : (type === "email.bounced" || type === "email.failed") && (row.status === "sent" || row.status === "delivered")
        ? ("failed" as const)
        : undefined;
  await db
    .update(outreach)
    .set({ tracking, ...(next ? { status: next } : {}) })
    .where(eq(outreach.id, row.id));
  return { matched: true, outreachId: row.id };
}
