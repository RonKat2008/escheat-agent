import { eq } from "drizzle-orm";
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
