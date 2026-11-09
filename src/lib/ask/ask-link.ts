/**
 * "Do it in Ask" links (docs/ASK-MODE.md slice 5). `/ask?q=…` sends the prompt as the first question of a new
 * conversation (ChatApp's `q` param), so a link may only exist for a prompt Ask can actually answer today: a recorded
 * first question or a known shape offline chat answers straight from the data. A dashboard link never lands on
 * "no recorded answer", and with chat not configured (the composer is disabled) there is no Ask link at all.
 *
 * Pure and client-safe.
 */
import type { ChatAvailability } from "@/lib/chat/agent";
import { CHAT_LIMITS } from "@/lib/chat/protocol";
import { offlineAnswerable } from "./starters";

/** `/ask?q=<prompt>`: trimmed, capped at the chat's user-message limit, then URL-encoded. */
export function askHref(prompt: string): string {
  const q = prompt.trim().slice(0, CHAT_LIMITS.maxUserChars);
  return `/ask?q=${encodeURIComponent(q)}`;
}

/**
 * The Ask link for `prompt`, or null when Ask cannot answer it right now. The prompt must be answerable without a model
 * (recorded or a direct offline intent), so the link works whether chat is live or replaying.
 */
export function askLinkFor(prompt: string, availability: ChatAvailability): string | null {
  if (availability === "not_configured") return null;
  return offlineAnswerable(prompt) ? askHref(prompt) : null;
}
