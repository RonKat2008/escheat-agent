/**
 * Stable cassette key for the chat loop.
 *
 * The raw request is not replay-stable: tool results carry random row UUIDs and timestamps, tool_use ids come
 * from the API, and prior assistant turns embed a tool-fact note. This module reduces a request to what actually
 * determines the model's answer, so the same conversation over the same seeded data hashes the same on every run:
 *
 *  - model, system, tools, output_config: kept verbatim (they are frozen constants).
 *  - user text / assistant text: kept verbatim; the bracketed tool-fact note on earlier assistant turns is dropped
 *    (it is derived from tool results already covered below, and the client may truncate it).
 *  - thinking blocks: dropped (opaque signatures, no information the text does not carry).
 *  - tool_use: name + input only; ids become ordinals ("call_1"...).
 *  - tool_result: content is kept but scrubbed of UUIDs and timestamps, so a replay over differently-seeded data
 *    (different numbers) misses the cassette and reports "no recorded answer" instead of narrating stale figures.
 *
 * Tool results are always recomputed live from the DB during replay; only the model's responses are replayed.
 */
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { canonicalize, type CassetteRequest } from "@/lib/llm/cassette";

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const TIMESTAMP_RE = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g;
// The note header changed when toolContext became untrusted input; recorded cassettes carry the legacy header.
const TOOL_NOTE_RE =
  /^\[(?:Record of the tool results behind this reply, for reference|Unverified notes about earlier tool results[^\]\n]*)\]\n[^\n]*(?:\n[^\n]+)*(?:\n\n)?/;

export function scrubVolatile(text: string): string {
  return text.replace(UUID_RE, "<uuid>").replace(TIMESTAMP_RE, "<ts>");
}

type Scrub = (text: string) => string;

function scrubDeep(value: unknown, scrub: Scrub): unknown {
  if (typeof value === "string") return scrub(value);
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, scrub));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrubDeep(v, scrub)]));
  }
  return value;
}

function toolResultText(content: Anthropic.ToolResultBlockParam["content"]): string {
  if (typeof content === "string") return content;
  return (content ?? []).map((b) => (b.type === "text" ? b.text : `[${b.type}]`)).join("\n");
}

export function normalizeMessages(messages: Anthropic.MessageParam[], scrub: Scrub = scrubVolatile): unknown[] {
  const ordinals = new Map<string, string>();
  const ordinal = (id: string) => {
    if (!ordinals.has(id)) ordinals.set(id, `call_${ordinals.size + 1}`);
    return ordinals.get(id)!;
  };
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.role === "assistant" ? m.content.replace(TOOL_NOTE_RE, "") : m.content };
    }
    const blocks: unknown[] = [];
    for (const b of m.content) {
      if (b.type === "text") blocks.push({ type: "text", text: b.text });
      else if (b.type === "tool_use") blocks.push({ type: "tool_use", id: ordinal(b.id), name: b.name, input: scrubDeep(b.input, scrub) });
      else if (b.type === "tool_result") {
        blocks.push({
          type: "tool_result",
          tool_use_id: ordinal(b.tool_use_id),
          is_error: b.is_error ?? false,
          content: scrub(toolResultText(b.content)),
        });
      }
      // thinking / redacted_thinking and anything else: intentionally excluded from the key.
    }
    return { role: m.role, content: blocks };
  });
}

/** The request that is hashed, recorded in the cassette, and looked up on replay. */
export function chatCassetteRequest(body: Anthropic.MessageCreateParamsNonStreaming): CassetteRequest {
  return {
    model: body.model,
    system: body.system,
    messages: normalizeMessages(body.messages),
    tools: body.tools,
    output_config: body.output_config,
  };
}

/**
 * Collision guard stored beside every recording. The replay key above deliberately erases row identity (every UUID
 * becomes "<uuid>") so replays survive reseeding, which also means two requests that differ only in WHICH row they
 * name share a key. This fingerprint keeps that identity as first-appearance ordinals ("<uuid:1>", "<uuid:2>"), so it
 * is just as stable across runs but differs whenever the key conflates distinct requests. Covers model, system,
 * tools, output_config and the messages. A key hit whose fingerprint differs is a collision and must not replay.
 */
export function strictFingerprint(body: Anthropic.MessageCreateParamsNonStreaming): string {
  const seen = new Map<string, number>();
  const scrub: Scrub = (text) =>
    text
      .replace(UUID_RE, (u) => {
        const k = u.toLowerCase();
        if (!seen.has(k)) seen.set(k, seen.size + 1);
        return `<uuid:${seen.get(k)}>`;
      })
      .replace(TIMESTAMP_RE, "<ts>");
  const material = { model: body.model, system: body.system, tools: body.tools, output_config: body.output_config, messages: normalizeMessages(body.messages, scrub) };
  return createHash("sha256").update(canonicalize(material)).digest("hex");
}
