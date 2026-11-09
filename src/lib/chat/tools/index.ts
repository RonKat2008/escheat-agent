import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createOutreachDraftTool, getAgentRunTool, listAgentRunsTool, startRecoverySearchTool } from "./actions";
import { planCloseOutTool } from "./closeout";
import type { ChatTool, ChatToolContext } from "./define";
import { runTool, type ToolExecution } from "./run";
import { auditInterestTool, explainItemTool, getExposureTool, getForecastTool, listStaleItemsTool, upcomingDeadlinesTool } from "./insights";
import { advanceClockTool, getClockTool, openViewTool } from "./system";
import { generateReportTool, listPendingApprovalsTool, listRecoveriesTool, listReportsTool, listRulesTool } from "./workflow";

export { ChatToolError, type ChatToolContext } from "./define";

/** Fixed order: the tool list is part of the cached prompt prefix. */
export const CHAT_TOOLS: readonly ChatTool[] = [
  getExposureTool,
  listStaleItemsTool,
  explainItemTool,
  upcomingDeadlinesTool,
  getForecastTool,
  auditInterestTool,
  listPendingApprovalsTool,
  createOutreachDraftTool,
  listRulesTool,
  listReportsTool,
  generateReportTool,
  planCloseOutTool,
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

export type { ToolExecution } from "./run";

/** Validates the model's input against the tool's zod schema, then runs it. Never throws. */
export function executeChatTool(name: string, rawInput: unknown, ctx: ChatToolContext): Promise<ToolExecution> {
  return runTool(BY_NAME.get(name), name, rawInput, ctx);
}
