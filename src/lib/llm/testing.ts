import type Anthropic from "@anthropic-ai/sdk";
import type { LlmClient } from "./client";

type Block = Record<string, unknown>;

export function message(content: Block[], opts: { stop_reason?: string; usage?: Record<string, unknown>; model?: string } = {}): Anthropic.Message {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    type: "message",
    role: "assistant",
    model: opts.model ?? "mock",
    content,
    stop_reason: opts.stop_reason ?? (content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn"),
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50, ...opts.usage },
  } as unknown as Anthropic.Message;
}

export function toolUseMessage(name: string, input: unknown, extraBlocks: Block[] = [], opts: Parameters<typeof message>[1] = {}) {
  return message([...extraBlocks, { type: "tool_use", id: `toolu_${Math.random().toString(36).slice(2)}`, name, input }], opts);
}

export type Responder = Anthropic.Message | ((body: Anthropic.MessageCreateParamsNonStreaming) => Anthropic.Message);

/** Mock client returning scripted responses in order; records every request body. */
export function mockClient(script: Responder[]): LlmClient & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  let i = 0;
  return {
    calls,
    messages: {
      async create(body) {
        calls.push(JSON.parse(JSON.stringify(body)));
        const next = script[i++];
        if (!next) throw new Error(`mockClient: no scripted response for call #${i}`);
        return typeof next === "function" ? next(body) : next;
      },
    },
  };
}

/** A structured-output response: JSON in a text block. */
export function jsonMessage(value: unknown, extraBlocks: Block[] = [], opts: Parameters<typeof message>[1] = {}) {
  return message([...extraBlocks, { type: "text", text: JSON.stringify(value) }], opts);
}
