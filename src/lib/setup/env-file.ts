/**
 * Pure helpers for `pnpm setup` / `pnpm doctor`: reading .env files, creating .env.local from .env.example,
 * and generating local-only secrets. Nothing here returns anything meant to be printed except variable NAMES.
 */
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync } from "node:fs";

/** Secrets that are safe to generate locally when empty (random, local-only; each needs 16+ chars). */
export const LOCAL_SECRET_NAMES = ["OWNER_LINK_SECRET", "MCP_TOKEN"] as const;

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

function stripQuotes(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) return v.slice(1, -1);
  return v;
}

/** Parse KEY=VALUE lines (comments and blanks ignored). Values stay in memory; never print them. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const m = ASSIGNMENT.exec(line);
    if (m?.[1] !== undefined) out[m[1]] = stripQuotes(m[2] ?? "");
  }
  return out;
}

/** Variable names declared in .env.example, active (`NAME=`) or optional-and-off (`# NAME=`). */
export function declaredNames(exampleText: string): string[] {
  const names = new Set(Object.keys(parseEnv(exampleText)));
  for (const line of exampleText.split(/\r?\n/)) {
    const m = /^#\s*([A-Z][A-Z0-9_]*)=/.exec(line);
    if (m?.[1]) names.add(m[1]);
  }
  return [...names];
}

export type EnvFileResult = "created" | "exists" | "no-example";

/** Create `target` from `example` only when `target` is missing. Never overwrites an existing file. */
export function ensureEnvFile(example: string, target: string): EnvFileResult {
  if (existsSync(target)) return "exists";
  if (!existsSync(example)) return "no-example";
  copyFileSync(example, target);
  return "created";
}

export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * Fill ONLY empty `NAME=` assignments for the given names. A name that already has a value is left untouched;
 * a name that is absent is appended. Returns the new text and the NAMES filled (never the values).
 */
export function fillEmptySecrets(
  text: string,
  names: readonly string[] = LOCAL_SECRET_NAMES,
  generate: () => string = randomSecret,
): { text: string; filled: string[] } {
  const filled: string[] = [];
  const present = parseEnv(text);
  let next = text;
  for (const name of names) {
    if (present[name]) continue;
    const value = generate();
    const emptyLine = new RegExp(`^(\\s*(?:export\\s+)?${name}\\s*=)[ \\t]*(?:""|'')?[ \\t]*$`, "m");
    if (emptyLine.test(next)) {
      next = next.replace(emptyLine, (_m, head: string) => `${head}${value}`);
    } else {
      next = `${next}${next === "" || next.endsWith("\n") ? "" : "\n"}${name}=${value}\n`;
    }
    filled.push(name);
  }
  return { text: next, filled };
}

/** Effective env for checks: .env.local values overlaid by non-empty process.env values (shell wins, like Next). */
export function effectiveEnv(fileEnv: Record<string, string>, processEnv: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const merged: Record<string, string> = { ...fileEnv };
  for (const [k, v] of Object.entries(processEnv)) if (v !== undefined && v !== "") merged[k] = v;
  return merged;
}
