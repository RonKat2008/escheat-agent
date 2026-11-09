import type { UiPayload } from "../ui-types";
import { ChatToolError, type ChatTool, type ChatToolContext } from "./define";

export type ToolExecution =
  | { ok: true; summary: string; data: unknown; ui: UiPayload }
  | { ok: false; summary: string; error: string; ui: UiPayload; refused?: boolean; modelError?: string };

const fail = (error: string, opts: { refused?: boolean; modelNote?: string } = {}): ToolExecution => ({
  ok: false,
  summary: error,
  error,
  ui: { kind: "error", props: opts.refused ? { message: error, refused: true } : { message: error } },
  ...(opts.refused ? { refused: true } : {}),
  ...(opts.modelNote ? { modelError: `${error} ${opts.modelNote}` } : {}),
});

/**
 * Validates `rawInput` against the tool's zod schema, then runs it. Never throws. Shared by the model's tools
 * (CHAT_TOOLS) and the Ask action-card tools (src/lib/ask/cards/tools.ts), which each pass their own lookup.
 */
export async function runTool(tool: ChatTool | undefined, name: string, rawInput: unknown, ctx: ChatToolContext): Promise<ToolExecution> {
  if (!tool) return fail(`Unknown tool "${name}".`);
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return fail(`Invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`);
  }
  try {
    const out = await tool.run(ctx, parsed.data);
    return { ok: true, summary: out.summary, data: out.data, ui: out.ui };
  } catch (err) {
    if (err instanceof ChatToolError) return fail(err.message, { refused: err.refused, modelNote: err.modelNote });
    console.error(`[chat] tool ${name} failed:`, err);
    return fail(`${name} failed unexpectedly. Details are in the server log.`);
  }
}
