import type { Db } from "@/db/client";
import type { Env } from "@/lib/env";

/**
 * Orchestration for `pnpm smoke:live`: skip detection, PASS/FAIL aggregation, table output, exit code.
 * Pure of any vendor SDK; the per-service checks live in checks.ts and are injected here.
 */

export type SmokeStatus = "PASS" | "FAIL" | "SKIPPED";

export interface SmokeResult {
  service: string;
  status: SmokeStatus;
  detail: string;
  ms: number;
}

export interface SmokeArgs {
  /** Place one real SIMULATED call to an allowlisted number. Off by default. */
  dial: boolean;
  /** Optional override for the dialed number; must still be on ALLOWED_TEST_PHONES. */
  dialTo?: string;
  /** Write the results as JSON to this path. */
  json?: string;
  /** Only run these services (names as printed in the table, case-insensitive). */
  only?: string[];
}

export interface SmokeContext {
  /** Validated env (same parser the app uses). */
  env: Env;
  /** Raw process env, for variables the app schema does not know (STAGEHAND_MODEL, QBO_SMOKE_*). */
  raw: Record<string, string | undefined>;
  args: SmokeArgs;
  /** Scratch PGlite database (never DATABASE_URL, never the app's data dir). Lazy: only built when a check needs it. */
  getDb: () => Promise<Db>;
  fetch: typeof fetch;
}

/** Thrown by a check's run() when it discovers it cannot meaningfully run (e.g. replica not reachable). */
export class SkipCheck extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SkipCheck";
  }
}

export interface ServiceCheck {
  service: string;
  /** A reason string when the service is not configured (lists the missing env vars); undefined when it should run. */
  skipReason(ctx: SmokeContext): string | undefined;
  /** Smallest safe real call. Resolves to a one-line detail; throws on failure. */
  run(ctx: SmokeContext): Promise<string>;
}

const SECRET_NAME = /KEY|SECRET|TOKEN|PASSCODE/i;
const MIN_SECRET_LEN = 8;

/** Strip configured secret values from a message before it is printed or written to JSON. */
export function redact(message: string, raw: Record<string, string | undefined>): string {
  let out = message;
  for (const [name, value] of Object.entries(raw)) {
    if (value && value.length >= MIN_SECRET_LEN && SECRET_NAME.test(name)) out = out.split(value).join("[redacted]");
  }
  return out;
}

export function missingVars(raw: Record<string, string | undefined>, names: readonly string[]): string[] {
  return names.filter((n) => !raw[n]?.trim());
}

export function notConfigured(missing: readonly string[]): string | undefined {
  return missing.length > 0 ? `not configured: missing ${missing.join(", ")}` : undefined;
}

export async function runChecks(
  checks: readonly ServiceCheck[],
  ctx: SmokeContext,
  now: () => number = Date.now,
): Promise<SmokeResult[]> {
  const only = ctx.args.only?.map((s) => s.toLowerCase());
  const results: SmokeResult[] = [];
  for (const check of checks) {
    if (only && !only.includes(check.service.toLowerCase())) continue;
    const started = now();
    const done = (status: SmokeStatus, detail: string): void => {
      results.push({ service: check.service, status, detail: redact(detail, ctx.raw), ms: now() - started });
    };
    let skip: string | undefined;
    try {
      skip = check.skipReason(ctx);
    } catch (e) {
      done("FAIL", errorMessage(e));
      continue;
    }
    if (skip) {
      done("SKIPPED", skip);
      continue;
    }
    try {
      done("PASS", await check.run(ctx));
    } catch (e) {
      if (e instanceof SkipCheck) done("SKIPPED", e.message);
      else done("FAIL", errorMessage(e));
    }
  }
  return results;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/** Non-zero iff any configured service FAILED. SKIPPED never fails the run. */
export function exitCodeFor(results: readonly SmokeResult[]): 0 | 1 {
  return results.some((r) => r.status === "FAIL") ? 1 : 0;
}

const DETAIL_MAX = 150;

export function formatTable(results: readonly SmokeResult[]): string {
  const rows = results.map((r) => [
    r.service,
    r.status,
    `${r.detail.length > DETAIL_MAX ? `${r.detail.slice(0, DETAIL_MAX - 1)}…` : r.detail}${r.status === "SKIPPED" ? "" : ` (${r.ms}ms)`}`,
  ]);
  const head = ["service", "status", "detail"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cols: string[]) => cols.map((c, i) => (i === 2 ? c : c.padEnd(widths[i]!))).join("  ");
  const counts = (s: SmokeStatus) => results.filter((r) => r.status === s).length;
  return [
    line(head),
    line(widths.map((w) => "-".repeat(Math.min(w, 24)))),
    ...rows.map(line),
    "",
    `${counts("PASS")} passed, ${counts("FAIL")} failed, ${counts("SKIPPED")} skipped`,
  ].join("\n");
}

export function toJson(results: readonly SmokeResult[], generatedAt: Date): string {
  return JSON.stringify(
    { generatedAt: generatedAt.toISOString(), ok: exitCodeFor(results) === 0, results },
    null,
    2,
  );
}

export class ArgError extends Error {}

export function parseArgs(argv: readonly string[]): SmokeArgs {
  const args: SmokeArgs = { dial: false };
  const value = (flag: string, i: number, inline: string | undefined): [string, number] => {
    if (inline !== undefined) return [inline, i];
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) throw new ArgError(`${flag} needs a value`);
    return [next, i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i]!.split(/=(.*)/s, 2) as [string, string | undefined];
    if (flag === "--dial") args.dial = true;
    else if (flag === "--json") [args.json, i] = value(flag, i, inline);
    else if (flag === "--dial-to") [args.dialTo, i] = value(flag, i, inline);
    else if (flag === "--only") {
      const [v, j] = value(flag, i, inline);
      args.only = v.split(",").map((s) => s.trim()).filter(Boolean);
      i = j;
    } else throw new ArgError(`unknown argument ${argv[i]}`);
  }
  if (args.dialTo && !args.dial) throw new ArgError("--dial-to only makes sense together with --dial");
  return args;
}
