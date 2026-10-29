import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { ledgerItems, outreach, payees, staleItems, type StaleItem } from "@/db/schema";
import { parseOwnerReply, type ParsedReply } from "@/lib/agents/reply-parser";
import { hasAnthropic, isOffline } from "@/lib/env";
import { ownerResponded } from "@/inngest/events";
import { assertOwnerTokenUsable, markOwnerTokenUsed } from "./tokens";
import { loadOutreach, mergeTracking } from "./util";

export const OWNER_INTENTS = ["confirm_address", "already_cashed", "send_money"] as const;
export type OwnerIntent = (typeof OWNER_INTENTS)[number];

export const ownerResponseSchema = z
  .object({
    intent: z.enum(OWNER_INTENTS),
    address: z
      .object({
        line1: z.string().trim().min(1).max(200),
        city: z.string().trim().min(1).max(100),
        state: z.string().trim().length(2),
        zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "ZIP must look like 94105 or 94105-1234"),
      })
      .optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.intent === "confirm_address" && !v.address) {
      ctx.addIssue({ code: "custom", path: ["address"], message: "Please enter your mailing address." });
    }
  });
export type OwnerResponseInput = z.infer<typeof ownerResponseSchema>;

/**
 * Stale statuses an owner reply may move (to owner_responded ONLY). The public link is a bearer token and its
 * claims are unverified: it never moves an item out of to_report/reported/remitted and never sets resolved_paid
 * (security review H2). resolved_paid needs an authenticated in-app action or a matched bank clear.
 */
const MOVABLE: StaleItem["status"][] = ["watching", "dd_pending", "dd_sent", "owner_responded"];

const HOLDER_TASK = {
  confirm_address: "update_address",
  already_cashed: "verify_cleared",
  send_money: "verify_and_reissue",
} as const;

const EVENT_OUTCOME = {
  confirm_address: "address_updated",
  already_cashed: "no_longer_owner",
  send_money: "claims_property",
} as const;

export interface OwnerResponseDeps {
  now?: Date;
  secret?: string;
  /** Parse the free-text note. Defaults to the model parser when ANTHROPIC_API_KEY is set. */
  parseReply?: (text: string) => Promise<ParsedReply>;
  /** Best-effort Inngest notification. */
  sendEvent?: (data: { staleItemId: string; outcome: (typeof EVENT_OUTCOME)[OwnerIntent]; receivedAt: string }) => Promise<void>;
}

async function defaultSendEvent(data: { staleItemId: string; outcome: (typeof EVENT_OUTCOME)[OwnerIntent]; receivedAt: string }) {
  const { inngest } = await import("@/inngest/client");
  await Promise.race([
    inngest.send(ownerResponded.create({ ...data, channel: "web" })),
    new Promise((_, rej) => setTimeout(() => rej(new Error("inngest send timeout")), 2000)),
  ]);
}

async function parseNote(note: string, deps: OwnerResponseDeps): Promise<{ parsed: ParsedReply | null; error?: string }> {
  const parse = deps.parseReply ?? (hasAnthropic() && !isOffline() ? (t: string) => parseOwnerReply(t) : undefined);
  if (!parse) return { parsed: null };
  try {
    return { parsed: await parse(note) };
  } catch (e) {
    return { parsed: null, error: e instanceof Error ? e.name : "unknown" };
  }
}

export interface OwnerResponseResult {
  outreachId: string;
  staleItemId: string;
  intent: OwnerIntent;
  staleStatus: StaleItem["status"];
}

/**
 * Record an owner's web response. Single use: the token is consumed atomically with the writes.
 * Throws OwnerTokenError (malformed / expired / already_used / ...) or ZodError.
 */
export async function recordOwnerResponse(
  db: Db,
  token: string,
  rawInput: unknown,
  deps: OwnerResponseDeps = {},
): Promise<OwnerResponseResult> {
  const at = deps.now ?? new Date();
  const input = ownerResponseSchema.parse(rawInput);
  const { outreachId } = await assertOwnerTokenUsable(db, token, at, deps.secret);
  const row = await loadOutreach(db, outreachId);
  const [stale] = await db.select().from(staleItems).where(eq(staleItems.id, row.staleItemId));
  if (!stale) throw new Error("stale item missing for outreach");

  const { parsed, error: parseError } = input.note ? await parseNote(input.note, deps) : { parsed: null, error: undefined };

  const nextStatus: StaleItem["status"] = MOVABLE.includes(stale.status) ? "owner_responded" : stale.status;
  const ownerNote =
    input.intent === "confirm_address"
      ? "owner confirmed mailing address via web link"
      : input.intent === "already_cashed"
        ? "owner says the item was already cashed - holder to verify it cleared"
        : "owner requested payment - holder to verify identity and reissue";

  const response = {
    channel: "web",
    intent: input.intent,
    address: input.address ?? null,
    note: input.note ?? null,
    parsedNote: parsed,
    parseError: parseError ?? null,
    receivedAt: at.toISOString(),
  };

  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await markOwnerTokenUsed(t, outreachId, at); // atomic single-use guard; throws already_used on a race
    await t
      .update(outreach)
      .set({ status: "responded", tracking: mergeTracking(row.tracking, { response }) })
      .where(eq(outreach.id, outreachId));
    const prevClass = (stale.classification ?? {}) as Record<string, unknown>;
    await t
      .update(staleItems)
      .set({
        status: nextStatus,
        classification: {
          ...prevClass,
          ownerResponse: {
            intent: input.intent,
            note: ownerNote,
            holderTask: HOLDER_TASK[input.intent],
            at: at.toISOString(),
            outreachId,
          },
        },
      })
      .where(eq(staleItems.id, stale.id));
    if (input.intent === "confirm_address" && input.address) {
      const a = input.address;
      const fields = { addressLine: a.line1, city: a.city, state: a.state.toUpperCase(), zip: a.zip };
      const [ledger] = await t.select().from(ledgerItems).where(eq(ledgerItems.id, stale.ledgerItemId));
      const payeeId = stale.ownerPayeeId ?? ledger?.payeeId;
      if (payeeId) await t.update(payees).set(fields).where(eq(payees.id, payeeId));
      await t.update(ledgerItems).set(fields).where(eq(ledgerItems.id, stale.ledgerItemId));
    }
  });

  try {
    await (deps.sendEvent ?? defaultSendEvent)({
      staleItemId: stale.id,
      outcome: EVENT_OUTCOME[input.intent],
      receivedAt: at.toISOString(),
    });
  } catch (e) {
    console.warn("[owner] owner/responded event not delivered (best effort):", e instanceof Error ? e.message : e);
  }
  return { outreachId, staleItemId: stale.id, intent: input.intent, staleStatus: nextStatus };
}
