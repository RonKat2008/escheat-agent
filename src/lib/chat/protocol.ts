/**
 * Wire protocol for /api/chat, shared by the route, the agent loop and the client. Client-safe: no server imports.
 *
 * The client sends a text-only transcript; each assistant turn may carry the compact `toolContext` the server
 * returned for it, so follow-up questions keep the facts the tools produced. The server streams NDJSON events.
 */
import { z } from "zod";
import type { UiPayload } from "./ui-types";

export type { UiPayload, UiKind } from "./ui-types";

export const CHAT_LIMITS = {
  /** Messages in one request (user + assistant). Older turns are dropped client-side before this is hit. */
  maxMessages: 40,
  maxUserChars: 4_000,
  maxAssistantChars: 12_000,
  maxToolContextChars: 6_000,
  /** Sum over every text and toolContext in the request. */
  maxTotalChars: 80_000,
  /** Model calls per user turn (each tool round is one call). */
  maxModelCalls: 8,
  /** Output tokens per model call (includes adaptive thinking). */
  maxTokens: 8_000,
} as const;

const Message = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), text: z.string().trim().min(1).max(CHAT_LIMITS.maxUserChars) }),
  z.object({
    role: z.literal("assistant"),
    text: z.string().max(CHAT_LIMITS.maxAssistantChars),
    toolContext: z.string().max(CHAT_LIMITS.maxToolContextChars).optional(),
  }),
]);
export type ChatMessage = z.infer<typeof Message>;

export const ChatRequestSchema = z
  .object({ messages: z.array(Message).min(1).max(CHAT_LIMITS.maxMessages) })
  .superRefine((body, ctx) => {
    if (body.messages[0]?.role !== "user") ctx.addIssue({ code: "custom", message: "The first message must come from the user" });
    if (body.messages.at(-1)?.role !== "user") ctx.addIssue({ code: "custom", message: "The last message must come from the user" });
    const total = body.messages.reduce((n, m) => n + m.text.length + (m.role === "assistant" ? (m.toolContext?.length ?? 0) : 0), 0);
    if (total > CHAT_LIMITS.maxTotalChars) {
      ctx.addIssue({ code: "custom", message: `Conversation too long (${total} characters). Start a new chat.` });
    }
  });
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number | null;
}

/** One NDJSON line on the response stream. */
export type ChatEvent =
  | { type: "start"; model: string; runId: string | null; offline: boolean }
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; label: string }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string; ui: UiPayload }
  | { type: "error"; code: ChatErrorCode; message: string }
  | { type: "done"; toolContext: string; usage: ChatUsage; runId: string | null; stopReason: string | null };

export type ChatErrorCode =
  | "not_configured"
  | "offline_unavailable"
  | "rate_limited"
  | "invalid_request"
  | "model_error"
  | "refusal"
  | "turn_limit"
  | "aborted";

export function encodeEvent(e: ChatEvent): string {
  return `${JSON.stringify(e)}\n`;
}

/** Splits an NDJSON buffer into complete events plus the unfinished tail. Malformed lines are skipped. */
export function decodeEvents(buffer: string): { events: ChatEvent[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: ChatEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as ChatEvent);
    } catch {
      /* partial or corrupt line: ignore */
    }
  }
  return { events, rest };
}
