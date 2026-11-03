import { sha256Hex } from "@/lib/crypto";
import { allowedRecipients, getEnv, type Env } from "@/lib/env";
import { isRecipientRef, maskRecipient, normalizeRecipient, RECIPIENT_REF_PREFIX, REF_HEX_LENGTH, refMaterial, type RecipientOption } from "./recipient-mask";

/** Server-only half of R4-24: build opaque refs for the allowlist and resolve them back to the full value. */

const normalize = normalizeRecipient;

export function recipientRef(channel: "email" | "voice", value: string): string {
  return `${RECIPIENT_REF_PREFIX}${sha256Hex(refMaterial(channel, value)).slice(0, REF_HEX_LENGTH)}`;
}

/** Phones split on , ; and newlines only, exactly like assertAllowedPhone ("+1 (415) 555-0100" contains spaces). */
function listFor(channel: "email" | "voice", env: Env): string[] {
  if (channel === "email") return allowedRecipients(env);
  const phones = (env.ALLOWED_TEST_PHONES ?? "").split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
  return [...new Set(phones)];
}

/** The allowlist as the browser may see it: refs and masked labels only. */
export function recipientOptions(channel: "email" | "voice", env: Env = getEnv()): RecipientOption[] {
  return listFor(channel, env).map((v) => ({ ref: recipientRef(channel, v), label: maskRecipient(channel, v) }));
}

/**
 * A ref from the client becomes the allowlisted value it stands for; anything else (a typed address) passes through
 * unchanged so the normal allowlist check still decides. An unknown ref stays a ref and therefore fails that check.
 */
export function resolveRecipient(channel: "letter" | "email" | "voice", to: string | null | undefined, env: Env = getEnv()): string | null | undefined {
  if (channel === "letter" || !isRecipientRef(to)) return to;
  return listFor(channel, env).find((v) => recipientRef(channel, v) === to) ?? to;
}

/** What the browser sees for a stored email/voice recipient: its ref when allowlisted, else nothing. Plus a masked label. */
export function recipientForClient(channel: "email" | "voice", stored: string | null, env: Env = getEnv()): { to: string | null; label: string | null } {
  if (!stored) return { to: null, label: null };
  const listed = listFor(channel, env).some((v) => normalize(channel, v) === normalize(channel, stored));
  return { to: listed ? recipientRef(channel, stored) : null, label: maskRecipient(channel, stored) };
}
