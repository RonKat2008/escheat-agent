/** Thrown when no Anthropic credentials / injected client exist. Callers decide the fallback. */
export class AnthropicNotConfigured extends Error {
  constructor(message = "ANTHROPIC_API_KEY is not set; the LLM layer is not configured.") {
    super(message);
    this.name = "AnthropicNotConfigured";
  }
}

/** Thrown in offline (replay-only) mode when no recorded cassette matches the request. Never invents output. */
export class OfflineCassetteMissing extends Error {
  readonly agent: string;
  readonly hash: string;
  constructor(agent: string, hash: string) {
    super(
      `ESCHEAT_OFFLINE is on and no cassette exists for agent "${agent}" (request hash ${hash}). ` +
        `Record one with ESCHEAT_RECORD=1 and an ANTHROPIC_API_KEY.`,
    );
    this.name = "OfflineCassetteMissing";
    this.agent = agent;
    this.hash = hash;
  }
}

/** The model's output failed Zod validation even after one corrective retry. */
export class StructuredOutputError extends Error {
  readonly issues: string;
  constructor(toolName: string, issues: string) {
    super(`Model output for tool "${toolName}" failed validation after retry: ${issues}`);
    this.name = "StructuredOutputError";
    this.issues = issues;
  }
}

/** The model declined (stop_reason "refusal"). */
export class LlmRefusalError extends Error {
  constructor(detail?: string) {
    super(`The model refused the request${detail ? `: ${detail}` : "."}`);
    this.name = "LlmRefusalError";
  }
}
