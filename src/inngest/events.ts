import { eventType } from "inngest";
import { z } from "zod";

/** Typed Inngest events. Payload schemas are Zod; send with `<event>.create({ data })`. */

export const clockAdvanced = eventType("clock/advanced", {
  schema: z.object({
    companyId: z.string().uuid(),
    /** Demo clock offset (days) after the advance. */
    offsetDays: z.number().int(),
    /** Simulated "now" as an ISO timestamp. */
    now: z.string().datetime(),
  }),
});

export const ownerResponded = eventType("owner/responded", {
  schema: z.object({
    staleItemId: z.string().uuid(),
    outcome: z.enum(["claims_property", "disputes", "no_longer_owner", "address_updated", "unparsed"]),
    channel: z.enum(["letter", "email", "voice", "web"]),
    receivedAt: z.string().datetime(),
  }),
});

export const itemStaleCreated = eventType("item/stale.created", {
  schema: z.object({
    staleItemId: z.string().uuid(),
    companyId: z.string().uuid(),
    ownerState: z.string().length(2).nullable(),
  }),
});

export const helloRequested = eventType("app/hello.requested", {
  schema: z.object({ name: z.string() }),
});

/** Emitted by whoever resolves an item (paid / cashed / cancelled); cancels its timeline run. */
export const itemResolved = eventType("item/resolved", {
  schema: z.object({ staleItemId: z.string().uuid() }),
});
