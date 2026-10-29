import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ORCHESTRATOR_MODEL, WORKER_MODEL } from "@config/models";
import type { Db } from "@/db/client";
import { getEnv, isOffline } from "@/lib/env";
import { readCassette, requestHash, writeCassette } from "./cassette";
import {
  AnthropicNotConfigured,
  LlmRefusalError,
  OfflineCassetteMissing,
  StructuredOutputError,
} from "./errors";
import { estimateCostMicros, type TokenUsage } from "./pricing";
import { finishRun, startRun } from "./runs";

export { AnthropicNotConfigured, OfflineCassetteMissing, StructuredOutputError, LlmRefusalError };

/** The slice of the SDK we use; tests inject a mock with this shape. */
export interface LlmClient {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

export type Tier = "orchestrator" | "worker";

export interface Citation {
  url: string;
  title: string | null;
  citedText: string | null;
  origin: "citation" | "search_result";
}

export interface WebSearchOptions {
  maxUses: number;
  allowedDomains?: string[];
}

export interface CallStructuredOptions<T> {
  tier: Tier;
  system: string;
  messages: Anthropic.MessageParam[];
  schema: z.ZodType<T>;
  toolName: string;
  toolDescription?: string;
  tools?: Anthropic.ToolUnion[];
  webSearch?: WebSearchOptions;
  agent: string;
  subjectId?: string;
  db?: Db;
  companyId?: string;
  staleItemId?: string;
  maxTokens?: number;
}

export interface StructuredResult<T> {
  data: T;
  citations: Citation[];
  usage: TokenUsage & { costUsdMicros: number | null };
  model: string;
  runId: string;
}

/** Web search server tool version (with allowed_callers ["direct"] to skip dynamic filtering). */
export const WEB_SEARCH_TOOL_TYPE = "web_search_20260318" as const;
const MAX_TURNS = 8;
const DEFAULT_MAX_TOKENS = 16_000;

/* ------------------------------------------------------------- client wiring */

let injected: LlmClient | undefined;

/** Inject (or clear with undefined) the client. Used by tests and by callers that own their own SDK instance. */
export function setAnthropicClient(client: LlmClient | undefined): void {
  injected = client;
}

export function modelFor(tier: Tier): string {
  return tier === "orchestrator" ? ORCHESTRATOR_MODEL : WORKER_MODEL;
}

/** True when a client is injected or an API key is present. */
export function isLlmConfigured(): boolean {
  return Boolean(injected) || Boolean(getEnv().ANTHROPIC_API_KEY);
}

export function getAnthropicClient(): LlmClient {
  if (injected) return injected;
  const apiKey = getEnv().ANTHROPIC_API_KEY;
  if (!apiKey) throw new AnthropicNotConfigured();
  return new Anthropic({ apiKey }) as unknown as LlmClient;
}

/* ------------------------------------------------------------ request layer */

/**
 * One API round trip with record/replay semantics:
 * offline => replay only; otherwise real call (recorded when ESCHEAT_RECORD=1).
 */
export async function sendMessage(
  body: Anthropic.MessageCreateParamsNonStreaming,
  agent: string,
): Promise<Anthropic.Message> {
  const hash = requestHash({
    model: body.model,
    system: body.system,
    messages: body.messages,
    tools: body.tools,
    output_config: body.output_config,
  });
  if (isOffline()) {
    const cassette = readCassette(agent, hash);
    if (!cassette) throw new OfflineCassetteMissing(agent, hash);
    return cassette.response;
  }
  const client = getAnthropicClient();
  const response = await client.messages.create(body);
  if (isRecordMode()) {
    writeCassette(
      agent,
      {
        model: body.model,
        system: body.system,
        messages: body.messages,
        tools: body.tools,
        output_config: body.output_config,
      },
      response,
    );
  }
  return response;
}

function isRecordMode(): boolean {
  return ["1", "true", "yes", "on"].includes((process.env.ESCHEAT_RECORD ?? "").trim().toLowerCase());
}

/* ---------------------------------------------------------------- helpers */

const emptyUsage = (): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  webSearchRequests: 0,
});

function addUsage(total: TokenUsage, msg: Anthropic.Message): void {
  const u = msg.usage as unknown as Record<string, unknown> | undefined;
  if (!u) return;
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  total.inputTokens += num(u.input_tokens);
  total.outputTokens += num(u.output_tokens);
  total.cacheReadTokens += num(u.cache_read_input_tokens);
  total.cacheCreationTokens += num(u.cache_creation_input_tokens);
  const server = u.server_tool_use as Record<string, unknown> | null | undefined;
  total.webSearchRequests += num(server?.web_search_requests);
}

function collectCitations(msg: Anthropic.Message, into: Map<string, Citation>): void {
  for (const block of msg.content as unknown as Array<Record<string, unknown>>) {
    if (block.type === "text" && Array.isArray(block.citations)) {
      for (const c of block.citations as Array<Record<string, unknown>>) {
        if (typeof c.url !== "string") continue;
        const key = `c|${c.url}|${String(c.cited_text ?? "")}`;
        into.set(key, {
          url: c.url,
          title: typeof c.title === "string" ? c.title : null,
          citedText: typeof c.cited_text === "string" ? c.cited_text : null,
          origin: "citation",
        });
      }
    }
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content as Array<Record<string, unknown>>) {
        if (typeof r.url !== "string") continue;
        const key = `s|${r.url}`;
        if (!into.has(key)) {
          into.set(key, {
            url: r.url,
            title: typeof r.title === "string" ? r.title : null,
            citedText: null,
            origin: "search_result",
          });
        }
      }
    }
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

function summarizeRequest(opts: CallStructuredOptions<unknown>, model: string): Record<string, unknown> {
  const last = [...opts.messages].reverse().find((m) => m.role === "user");
  const preview =
    typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
  return {
    tier: opts.tier,
    model,
    toolName: opts.toolName,
    systemChars: opts.system.length,
    messageCount: opts.messages.length,
    lastUserPreview: preview.slice(0, 500),
    webSearch: opts.webSearch ?? null,
    extraTools: (opts.tools ?? []).map((t) => ("name" in t ? t.name : "unknown")),
  };
}

/* ---------------------------------------------------------- callStructured */

function textOf(msg: Anthropic.Message): string {
  return (msg.content as unknown as Array<Record<string, unknown>>)
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
}

function parseJsonText<T>(text: string, schema: z.ZodType<T>): { ok: true; data: T } | { ok: false; issues: string } {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let raw: unknown;
  try {
    raw = JSON.parse(stripped);
  } catch {
    return { ok: false, issues: "response was not valid JSON" };
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, issues: formatIssues(parsed.error) };
}

/**
 * Get Zod-validated structured output using native structured outputs (output_config.format). Forced
 * tool_choice is rejected by the current Opus/Sonnet generation, so tool-use is not used for this.
 * The response is re-validated with the full Zod schema (the API grammar drops min/max constraints) and an
 * invalid answer gets exactly one corrective retry with the error fed back.
 *
 * `webSearch` switches to a two-call pattern, because citations conflict with structured outputs:
 * (1) a research call with the web search tool whose text + citations are collected, (2) a structuring
 * call that maps the findings into `schema`. Callers must verify sources against `result.citations`.
 * Logs to agent_runs when `db` is passed.
 */
export async function callStructured<T>(opts: CallStructuredOptions<T>): Promise<StructuredResult<T>> {
  const model = modelFor(opts.tier);
  const started = Date.now();
  const usage = emptyUsage();
  const citations = new Map<string, Citation>();
  const trace: unknown[] = [{ type: "request", ...summarizeRequest(opts, model) }];
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  const runId = opts.db
    ? await startRun(opts.db, {
        agent: opts.agent,
        model,
        subjectId: opts.subjectId,
        companyId: opts.companyId,
        staleItemId: opts.staleItemId,
        input: { request: summarizeRequest(opts, model) },
      })
    : undefined;

  const logFailure = async (err: unknown): Promise<never> => {
    if (opts.db) {
      await finishRun(opts.db, runId, {
        status: "failed",
        model,
        trace,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsdMicros: estimateCostMicros(model, usage),
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
    }
    throw err;
  };

  const call = async (body: Omit<Anthropic.MessageCreateParamsNonStreaming, "model" | "max_tokens">) => {
    const res = await sendMessage({ model, max_tokens: maxTokens, ...body }, opts.agent);
    addUsage(usage, res);
    collectCitations(res, citations);
    for (const b of res.content as unknown as Array<Record<string, unknown>>) {
      if (b.type === "server_tool_use" || b.type === "tool_use") {
        trace.push({ type: "tool_call", name: b.name, input: b.input });
      }
    }
    if (res.stop_reason === "refusal") throw new LlmRefusalError();
    if (res.stop_reason === "max_tokens") throw new Error(`Model hit max_tokens (${maxTokens}) before finishing.`);
    return res;
  };

  try {
    let structMessages: Anthropic.MessageParam[] = [...opts.messages];
    let structSystem = opts.system;

    if (opts.webSearch) {
      const researchTools: Anthropic.ToolUnion[] = [
        ...(opts.tools ?? []),
        {
          type: WEB_SEARCH_TOOL_TYPE,
          name: "web_search",
          max_uses: opts.webSearch.maxUses,
          allowed_callers: ["direct"],
          ...(opts.webSearch.allowedDomains ? { allowed_domains: opts.webSearch.allowedDomains } : {}),
        },
      ];
      const researchMessages: Anthropic.MessageParam[] = [...opts.messages];
      let findings = "";
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const res = await call({
          system: `${opts.system}\n\nUse the web search tool, then write your findings in plain text so every claim carries a citation.`,
          messages: researchMessages,
          tools: researchTools,
        });
        findings += `${findings ? "\n" : ""}${textOf(res)}`;
        if (res.stop_reason !== "pause_turn") break;
        researchMessages.push({ role: "assistant", content: res.content as Anthropic.ContentBlockParam[] });
      }
      trace.push({ type: "research_done", findingsChars: findings.length });
      const cited = [...citations.values()]
        .filter((c) => c.citedText)
        .map((c) => `- ${c.url}: "${c.citedText}"`)
        .join("\n");
      structMessages = [
        ...opts.messages,
        { role: "assistant", content: findings || "(no findings were produced)" },
        {
          role: "user",
          content:
            `Using ONLY the research findings above, produce the final JSON for \`${opts.toolName}\`. ` +
            `Use null where the findings do not support a value. Cited passages available:\n${cited || "(none)"}`,
        },
      ];
      structSystem = `${opts.system}\n\nProduce the final structured answer from the research findings. Do not invent facts.`;
    }

    const outputConfig = { format: zodOutputFormat(opts.schema as unknown as z.ZodType) };
    let retried = false;
    for (let turn = 0; turn < 3; turn++) {
      const res = await call({
        system: structSystem,
        messages: structMessages,
        output_config: outputConfig as Anthropic.MessageCreateParamsNonStreaming["output_config"],
        ...(opts.tools && !opts.webSearch ? { tools: opts.tools } : {}),
      });
      const text = textOf(res);
      const parsed = parseJsonText(text, opts.schema);
      if (parsed.ok) {
        const costUsdMicros = estimateCostMicros(model, usage);
        const list = [...citations.values()];
        trace.push({ type: "result", elapsedMs: Date.now() - started }, { type: "citations", citations: list });
        if (opts.db) {
          await finishRun(opts.db, runId, {
            status: "succeeded",
            model,
            output: { summary: `${opts.toolName} ok`, data: parsed.data as unknown },
            trace,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsdMicros,
          });
        }
        return {
          data: parsed.data,
          citations: list,
          usage: { ...usage, costUsdMicros },
          model,
          runId: runId ?? randomUUID(),
        };
      }
      if (retried) throw new StructuredOutputError(opts.toolName, parsed.issues);
      retried = true;
      trace.push({ type: "retry", reason: parsed.issues });
      structMessages = [
        ...structMessages,
        { role: "assistant", content: text || "(empty)" },
        {
          role: "user",
          content: `Your JSON failed validation: ${parsed.issues}. Return corrected JSON only.`,
        },
      ];
    }
    throw new StructuredOutputError(opts.toolName, "no valid output");
  } catch (err) {
    return logFailure(err);
  }
}
