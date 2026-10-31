import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { UiPayload } from "../ui-types";
import { createOutreachDraftTool, getAgentRunTool, listAgentRunsTool, startRecoverySearchTool } from "./actions";
import { ChatToolError, type ChatTool, type ChatToolContext } from "./define";
import { auditInterestTool, explainItemTool, getExposureTool, listStaleItemsTool, upcomingDeadlinesTool } from "./insights";
import { advanceClockTool, getClockTool, openViewTool } from "./system";
import { generateReportTool, listPendingApprovalsTool, listRecoveriesTool, listReportsTool, listRulesTool } from "./workflow";

export { ChatToolError, type ChatToolContext } from "./define";

/** Fixed order: the tool list is part of the cached prompt prefix. */
export const CHAT_TOOLS: readonly ChatTool[] = [
  getExposureTool,
  listStaleItemsTool,
  explainItemTool,
  upcomingDeadlinesTool,
  auditInterestTool,
  listPendingApprovalsTool,
  createOutreachDraftTool,
  listRulesTool,
  listReportsTool,
  generateReportTool,
  listRecoveriesTool,
  startRecoverySearchTool,
  listAgentRunsTool,
  getAgentRunTool,
  getClockTool,
  advanceClockTool,
  openViewTool,
] as ChatTool[];

const BY_NAME = new Map(CHAT_TOOLS.map((t) => [t.name, t]));

export function getChatTool(name: string): ChatTool | undefined {
  return BY_NAME.get(name);
}

export function toolLabel(name: string): string {
  return BY_NAME.get(name)?.label ?? "Working";
}

function inputSchemaOf(tool: ChatTool): Anthropic.Tool.InputSchema {
  const schema = Object.fromEntries(
    Object.entries(z.toJSONSchema(tool.input, { io: "input" }) as Record<string, unknown>).filter(([k]) => k !== "$schema"),
  );
  return { ...schema, type: "object" } as Anthropic.Tool.InputSchema;
}

/** Anthropic tool definitions, built once (deterministic, so the cached prefix stays stable). */
let cachedDefs: Anthropic.Tool[] | undefined;
export function anthropicToolDefinitions(): Anthropic.Tool[] {
  cachedDefs ??= CHAT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: inputSchemaOf(t),
    // Streamed tool inputs are re-validated with zod below before anything runs.
    eager_input_streaming: true,
  }));
  return cachedDefs;
}

export type ToolExecution =
  | { ok: true; summary: string; data: unknown; ui: UiPayload }
  | { ok: false; summary: string; error: string; ui: UiPayload };

const fail = (error: string): ToolExecution => ({ ok: false, summary: error, error, ui: { kind: "error", props: { message: error } } });

/** Validates the model's input against the tool's zod schema, then runs it. Never throws. */
export async function executeChatTool(name: string, rawInput: unknown, ctx: ChatToolContext): Promise<ToolExecution> {
  const tool = BY_NAME.get(name);
  if (!tool) return fail(`Unknown tool "${name}".`);
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return fail(`Invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`);
  }
  try {
    const out = await tool.run(ctx, parsed.data);
    return { ok: true, summary: out.summary, data: out.data, ui: out.ui };
  } catch (err) {
    if (err instanceof ChatToolError) return fail(err.message);
    console.error(`[chat] tool ${name} failed:`, err);
    return fail(`${name} failed unexpectedly. Details are in the server log.`);
  }
}
