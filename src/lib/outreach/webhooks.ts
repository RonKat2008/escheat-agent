import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach, webhookEvents } from "@/db/schema";
import { hmacSha256Hex, timingSafeEqual } from "@/lib/crypto";
import { appendEvent } from "./util";

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

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Atomically claim (source, eventId). The unique index makes concurrent deliveries race on the insert: exactly one
 * wins; the others block until the winner commits and then see a conflict. Runs inside the caller's transaction so
 * a failed tracking update releases the claim and the provider's retry is processed, not swallowed.
 */
async function claimEvent(tx: Tx, source: string, eventId: string): Promise<boolean> {
  const claimed = await tx.insert(webhookEvents).values({ source, eventId }).onConflictDoNothing().returning({ id: webhookEvents.id });
  return claimed.length > 0;
}

/** Append a Lob event to the matching letter's tracking (idempotent, atomically, on event id). */
export async function applyLobEvent(db: Db, event: LobEvent, receivedAt: Date = new Date()): Promise<WebhookApplyResult> {
  const letterId = event.body?.id ?? event.reference_id;
  if (!letterId) return { matched: false };
  const [found] = await db.select({ id: outreach.id }).from(outreach).where(eq(outreach.providerId, letterId));
  if (!found) return { matched: false };
  const type = typeof event.event_type === "string" ? event.event_type : (event.event_type?.id ?? "unknown");
  const eventId = event.id || null;
  return db.transaction(async (tx) => {
    if (eventId && !(await claimEvent(tx, "lob", eventId))) return { matched: true, duplicate: true, outreachId: found.id };
    // Lock the row so two different events for one letter cannot overwrite each other's tracking append.
    const [row] = await tx.select().from(outreach).where(eq(outreach.id, found.id)).for("update");
    if (!row) return { matched: false };
    const tracking = appendEvent(row.tracking, { source: "lob", id: eventId, type, at: event.date_created ?? null, receivedAt: receivedAt.toISOString() });
    const delivered = type === "letter.delivered" && (row.status === "sent" || row.status === "delivered");
    await tx
      .update(outreach)
      .set({ tracking, ...(delivered ? { status: "delivered" as const } : {}) })
      .where(eq(outreach.id, row.id));
    return { matched: true, outreachId: row.id };
  });
}

/** AgentMail webhook payload (Svix-signed). Each message.* event nests its data under delivery / bounce / reject / ... */
export interface AgentMailEvent {
  type?: string;
  event_type?: string;
  event_id?: string;
  send?: { message_id?: string; timestamp?: string };
  delivery?: { message_id?: string; timestamp?: string };
  bounce?: { message_id?: string; timestamp?: string; type?: string; sub_type?: string };
  reject?: { message_id?: string; timestamp?: string; reason?: string };
  complaint?: { message_id?: string; timestamp?: string; type?: string; sub_type?: string };
}

function agentmailDetail(event: AgentMailEvent): { messageId?: string; at?: string; detail: string | null } {
  const d = event.delivery ?? event.send ?? event.bounce ?? event.reject ?? event.complaint;
  const detail =
    event.bounce ? [event.bounce.type, event.bounce.sub_type].filter(Boolean).join("/") :
    event.reject ? (event.reject.reason ?? null) :
    event.complaint ? [event.complaint.type, event.complaint.sub_type].filter(Boolean).join("/") :
    null;
  return { messageId: d?.message_id, at: d?.timestamp, detail: detail || null };
}

/**
 * sent / delivered / bounced / rejected / complained -> outreach.tracking (+ status for delivered/bounced/rejected).
 * Matched on the AgentMail message_id stored as outreach.providerId; idempotent on the payload's event_id (the svix-id
 * differs between webhook levels, per AgentMail), falling back to the `svix-id` header when the payload has none, so
 * a payload without event_id is still deduped. Dedupe is atomic (see claimEvent). Inbound replies (message.received)
 * are not handled: no match.
 */
export async function applyAgentMailEvent(
  db: Db,
  event: AgentMailEvent,
  receivedAt: Date = new Date(),
  opts: { svixId?: string | null } = {},
): Promise<WebhookApplyResult> {
  const { messageId, at, detail } = agentmailDetail(event ?? {});
  if (!messageId) return { matched: false };
  const [found] = await db.select({ id: outreach.id }).from(outreach).where(eq(outreach.providerId, messageId));
  if (!found) return { matched: false };
  const eventId = event.event_id || opts.svixId || null;
  const type = event.event_type ?? "unknown";
  return db.transaction(async (tx) => {
    if (eventId && !(await claimEvent(tx, "agentmail", eventId))) return { matched: true, duplicate: true, outreachId: found.id };
    const [row] = await tx.select().from(outreach).where(eq(outreach.id, found.id)).for("update");
    if (!row) return { matched: false };
    const tracking = appendEvent(row.tracking, {
      source: "agentmail",
      id: eventId,
      type,
      at: at ?? null,
      detail,
      receivedAt: receivedAt.toISOString(),
    });
    const next =
      type === "message.delivered" && row.status === "sent"
        ? ("delivered" as const)
        : (type === "message.bounced" || type === "message.rejected") && (row.status === "sent" || row.status === "delivered")
          ? ("failed" as const)
          : undefined;
    await tx
      .update(outreach)
      .set({ tracking, ...(next ? { status: next } : {}) })
      .where(eq(outreach.id, row.id));
    return { matched: true, outreachId: row.id };
  });
}
