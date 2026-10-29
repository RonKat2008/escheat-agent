import { eq } from "drizzle-orm";
import { canonicalJson, sha256Hex } from "@/lib/crypto";
import type { Db } from "@/db/client";
import { outreach, type Outreach } from "@/db/schema";
import { OutreachNotFoundError, OutreachStateError } from "./errors";

export type Tracking = Record<string, unknown>;

export const SENDABLE_STATUSES: readonly Outreach["status"][] = ["draft", "awaiting_approval", "approved"];
export const EDITABLE_STATUSES = SENDABLE_STATUSES;

export async function loadOutreach(db: Db, id: string): Promise<Outreach> {
  const [row] = await db.select().from(outreach).where(eq(outreach.id, id));
  if (!row) throw new OutreachNotFoundError("Outreach", id);
  return row;
}

export function assertSendable(row: Outreach, channel: Outreach["channel"]): void {
  if (row.channel !== channel) {
    throw new OutreachStateError("wrong_channel", `Outreach ${row.id} is a ${row.channel} item, not ${channel}.`);
  }
  if (!SENDABLE_STATUSES.includes(row.status)) {
    throw new OutreachStateError("already_sent", `Outreach ${row.id} is already ${row.status}; refusing to send again.`);
  }
}

export function mergeTracking(prev: Tracking | null | undefined, patch: Tracking): Tracking {
  return { ...(prev ?? {}), ...patch };
}

export function appendEvent(prev: Tracking | null | undefined, event: Tracking): Tracking {
  const events = Array.isArray(prev?.events) ? (prev.events as Tracking[]) : [];
  return { ...(prev ?? {}), events: [...events, event] };
}

/** Same-origin relative path; works for the offline preview and as a link base. */
export const previewPath = (id: string) => `/api/outreach/${id}/preview`;

export function appBaseUrl(env: { APP_BASE_URL?: string }): string {
  return (env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** Crude tag stripper for the plain-text email part. Input is our own escaped HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Flag a row whose send outcome is unknown (M4): visible in the queue as failed, never auto-retried. */
export async function markNeedsReconciliation(db: Db, outreachId: string, err: unknown, at: Date = new Date()): Promise<void> {
  const row = await loadOutreach(db, outreachId);
  await db
    .update(outreach)
    .set({
      status: "failed",
      tracking: mergeTracking(row.tracking, {
        reconciliation: {
          required: true,
          at: at.toISOString(),
          reason: err instanceof Error ? err.message : String(err),
          note: "The provider call may have succeeded. Check the provider dashboard before drafting again.",
        },
      }),
    })
    .where(eq(outreach.id, outreachId));
}

/**
 * Hash of what a reviewer sees for a draft (channel, subject, body, and for letters the postal address).
 * The queue exposes it; approve requires it back, so approving content that changed after it was opened fails (M2).
 */
export function outreachContentSha256(row: Pick<Outreach, "id" | "channel" | "subject" | "body" | "toAddress">): string {
  return sha256Hex(
    canonicalJson({
      id: row.id,
      channel: row.channel,
      subject: row.subject ?? null,
      body: row.body ?? null,
      to: row.channel === "letter" ? (row.toAddress ?? null) : null,
    }),
  );
}
