import { z } from "zod";

/** Empty strings in .env files are treated as "unset". */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const optionalNumber = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? Number(v) : fallback))
    .pipe(z.number().int().nonnegative());

const flag = z
  .string()
  .optional()
  .transform((v) => ["1", "true", "yes", "on"].includes((v ?? "").trim().toLowerCase()));

const isoDate = optionalString.refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), {
  message: "must be YYYY-MM-DD",
});

export const envSchema = z.object({
  DATABASE_URL: optionalString,
  DATABASE_URL_TEST: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  ORCHESTRATOR_MODEL: optionalString,
  WORKER_MODEL: optionalString,
  INNGEST_EVENT_KEY: optionalString,
  INNGEST_SIGNING_KEY: optionalString,
  LOB_TEST_API_KEY: optionalString,
  LOB_WEBHOOK_SECRET: optionalString,
  RESEND_API_KEY: optionalString,
  RESEND_FROM: optionalString,
  RESEND_WEBHOOK_SECRET: optionalString,
  ALLOWED_TEST_RECIPIENTS: optionalString,
  ALLOWED_TEST_PHONES: optionalString,
  ESCHEAT_OFFLINE: flag,
  QBO_CLIENT_ID: optionalString,
  QBO_CLIENT_SECRET: optionalString,
  QBO_REDIRECT_URI: optionalString,
  PLAID_CLIENT_ID: optionalString,
  PLAID_SECRET: optionalString,
  PLAID_ENV: optionalString,
  ELEVENLABS_API_KEY: optionalString,
  ELEVENLABS_AGENT_ID: optionalString,
  ELEVENLABS_PHONE_NUMBER_ID: optionalString,
  APP_BASE_URL: optionalString,
  APP_PASSCODE: optionalString,
  OWNER_LINK_SECRET: optionalString,
  MCP_TOKEN: optionalString,
  STALE_THRESHOLD_DAYS: optionalNumber(180),
  DEMO_ANCHOR_DATE: isoDate,
  BROWSERBASE_API_KEY: optionalString,
  BROWSERBASE_PROJECT_ID: optionalString,
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

/**
 * Parse an env-like record. Never reads process.env at import time.
 * Throws EnvError only when a *present* value is malformed (e.g. a bad date).
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new EnvError(`Invalid environment: ${detail}`);
  }
  return result.data;
}

export function getEnv(): Env {
  return parseEnv(process.env);
}

export function isOffline(env: Env = getEnv()): boolean {
  return env.ESCHEAT_OFFLINE;
}

/** Lower-cased, de-duplicated allowlist parsed from a comma/semicolon/space separated list. */
export function allowedRecipients(env: Env = getEnv()): string[] {
  return [...new Set(splitList(env.ALLOWED_TEST_RECIPIENTS).map((s) => s.toLowerCase()))];
}

export function allowedPhones(env: Env = getEnv()): string[] {
  return [...new Set(splitList(env.ALLOWED_TEST_PHONES))];
}

export function staleThresholdDays(env: Env = getEnv()): number {
  return env.STALE_THRESHOLD_DAYS;
}

/** Demo "today" as YYYY-MM-DD, or undefined when not configured. */
export function demoAnchorDate(env: Env = getEnv()): string | undefined {
  return env.DEMO_ANCHOR_DATE;
}

export const hasDatabaseUrl = (env: Env = getEnv()) => Boolean(env.DATABASE_URL);
export const hasAnthropic = (env: Env = getEnv()) => Boolean(env.ANTHROPIC_API_KEY);
export const hasLob = (env: Env = getEnv()) => Boolean(env.LOB_TEST_API_KEY);
export const hasResend = (env: Env = getEnv()) => Boolean(env.RESEND_API_KEY);
export const hasInngestKeys = (env: Env = getEnv()) =>
  Boolean(env.INNGEST_EVENT_KEY && env.INNGEST_SIGNING_KEY);
export const hasQbo = (env: Env = getEnv()) => Boolean(env.QBO_CLIENT_ID && env.QBO_CLIENT_SECRET);
export const hasPlaid = (env: Env = getEnv()) => Boolean(env.PLAID_CLIENT_ID && env.PLAID_SECRET);
export const hasElevenLabs = (env: Env = getEnv()) =>
  Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_AGENT_ID);
export const hasBrowserbase = (env: Env = getEnv()) =>
  Boolean(env.BROWSERBASE_API_KEY && env.BROWSERBASE_PROJECT_ID);

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}
