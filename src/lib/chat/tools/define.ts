import { z } from "zod";
import type { Db } from "@/db/client";
import type { UiPayload } from "../ui-types";

/** Everything a chat tool may touch. There is deliberately no approver identity here: tools cannot approve. */
export interface ChatToolContext {
  db: Db;
  companyId: string;
}

/** `data` goes to the model (compact JSON); `ui` goes only to the client. */
export interface ChatToolOutput {
  summary: string;
  data: unknown;
  ui: UiPayload;
}

export interface ChatTool<S extends z.ZodType = z.ZodType> {
  name: string;
  /** Present-tense status shown on the client's working chip ("Reading exposure"). */
  label: string;
  description: string;
  input: S;
  /** True for the few tools that write (drafts, report files, agent runs, the demo clock). None of them approve or send. */
  writes: boolean;
  run(ctx: ChatToolContext, input: z.output<S>): Promise<ChatToolOutput>;
}

export function defineTool<S extends z.ZodType>(tool: ChatTool<S>): ChatTool<S> {
  return tool;
}

export interface ChatToolErrorOptions {
  /** The app declined on purpose (a rule said no). Shown as a neutral note, not a failure. */
  refused?: boolean;
  /** Extra guidance for the model only (appended to the tool result it reads; never shown in the UI). */
  modelNote?: string;
}

/** Thrown for expected, user-facing tool failures (unknown item, nothing to report, ...). */
export class ChatToolError extends Error {
  readonly refused: boolean;
  readonly modelNote: string | undefined;
  constructor(message: string, opts: ChatToolErrorOptions = {}) {
    super(message);
    this.name = "ChatToolError";
    this.refused = opts.refused ?? false;
    this.modelNote = opts.modelNote;
  }
}

export const STATE = z
  .string()
  .regex(/^[A-Za-z]{2}$/, "two-letter state code")
  .transform((s) => s.toUpperCase())
  .describe("Two-letter US state code of the OWNER's state, e.g. CA, TX, DE");

export const ITEM_REF = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .describe("Check number such as 10482 (a leading # is fine) or the stale item UUID");

export const normalizeItemRef = (ref: string) => ref.trim().replace(/^#/, "");

/** JSON payload for the model, capped so one tool can never flood the context. */
export function compactJson(value: unknown, maxChars = 12_000): string {
  const text = JSON.stringify(value);
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…[truncated ${text.length - maxChars} chars]`;
}
