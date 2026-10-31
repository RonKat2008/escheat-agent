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
  /** One tool record ("name(input) -> result") inside toolContext. */
  maxToolContextLineChars: 2_500,
  /** Sum over every text and toolContext in the request. */
  maxTotalChars: 80_000,
  /** Model calls per user turn (each tool round is one call). */
  maxModelCalls: 8,
  /** Output tokens per model call (includes adaptive thinking). */
  maxTokens: 8_000,
} as const;

const TOOL_RECORD_RE = /^[a-z][a-z0-9_]{0,63}\(.*\) -> .+$/;
// C0/C1 controls except \n, DEL, line/paragraph separators and bidi overrides/isolates.
const UNSAFE_CHARS_RE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/**
 * `toolContext` is client-supplied and unsigned, so it is never an authority: only lines shaped like the server's own
 * tool records ("name(input) -> result") survive, control characters are stripped and each line is capped. Everything
 * else (free text, headings, fake instructions) is dropped. The agent additionally keeps only known tool names and
 * frames the result as unverified. Pure and client-safe.
 */
export function sanitizeToolContext(raw: string): string {
  return raw
    .replace(UNSAFE_CHARS_RE, "")
    .split("\n")
    .map((line) => line.trim().slice(0, CHAT_LIMITS.maxToolContextLineChars))
    .filter((line) => TOOL_RECORD_RE.test(line))
    .join("\n");
}

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
  })
  // toolContext is unsigned client input: sanitize it on the way in (see sanitizeToolContext).
  .transform((body) => ({
    messages: body.messages.map((m): ChatMessage => {
      if (m.role !== "assistant" || m.toolContext === undefined) return m;
      const { toolContext, ...rest } = m;
      const clean = sanitizeToolContext(toolContext);
      return clean ? { ...rest, toolContext: clean } : rest;
    }),
  }));
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
