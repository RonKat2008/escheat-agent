/**
 * USD per 1M tokens. With integer micro-dollars, tokens * (USD per 1M tokens) is exactly micro-USD.
 * Source: Anthropic model pricing table (cached 2026-10). Update when models change.
 * Unknown models yield cost null (never a guess).
 */
export const MODEL_PRICES_USD_PER_MTOK: Record<string, { input: number; output: number; cacheRead?: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-fable-5": { input: 10, output: 50 },
};

/** Approximate list price of one server-side web search ($10 per 1,000 searches). */
export const WEB_SEARCH_COST_MICROS = 10_000;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  webSearchRequests: number;
}

export function estimateCostMicros(model: string, usage: TokenUsage): number | null {
  const price = MODEL_PRICES_USD_PER_MTOK[model];
  if (!price) return null;
  const cacheRate = price.cacheRead ?? price.input;
  return Math.round(
    usage.inputTokens * price.input +
      usage.cacheCreationTokens * price.input * 1.25 +
      usage.cacheReadTokens * cacheRate +
      usage.outputTokens * price.output +
      usage.webSearchRequests * WEB_SEARCH_COST_MICROS,
  );
}
