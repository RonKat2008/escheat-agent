/** Shared plumbing for scripts/setup.ts and scripts/doctor.ts. Never prints env values. */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { effectiveEnv, parseEnv } from "../../src/lib/setup/env-file";
import type { DbState } from "../../src/lib/setup/report";

export const ROOT = process.cwd();
export const ENV_EXAMPLE = path.join(ROOT, ".env.example");
export const ENV_LOCAL = path.join(ROOT, ".env.local");

export function readEnvLocal(): Record<string, string> {
  return existsSync(ENV_LOCAL) ? parseEnv(readFileSync(ENV_LOCAL, "utf8")) : {};
}

export function currentEnv(): Record<string, string> {
  return effectiveEnv(readEnvLocal(), process.env);
}

/** The pnpm that launched us (npm_execpath may be a JS file or a native binary), else whatever is on PATH. */
function pnpmCommand(args: string[]): [string, string[]] {
  const exec = process.env.npm_execpath;
  if (exec && /\.[cm]?js$/.test(exec)) return [process.execPath, [exec, ...args]];
  return [exec || "pnpm", args];
}

export function pnpmVersion(): string | null {
  const fromAgent = /^pnpm\/(\S+)/.exec(process.env.npm_config_user_agent ?? "");
  if (fromAgent?.[1]) return fromAgent[1];
  const [cmd, args] = pnpmCommand(["--version"]);
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Run a package.json script through pnpm with .env.local overlaid under the shell env. Returns the exit status. */
export function runPnpmScript(script: string): number {
  const env = { ...readEnvLocal(), ...process.env } as NodeJS.ProcessEnv;
  const [cmd, args] = pnpmCommand(["run", script]);
  return spawnSync(cmd, args, { stdio: "inherit", env }).status ?? 1;
}

export function pgliteDir(env: Record<string, string>): string {
  return path.resolve(ROOT, env.PGLITE_DATA_DIR?.trim() || ".data/pglite");
}

export function migrationsExpected(): number {
  const dir = path.join(ROOT, "drizzle");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".sql")).length : 0;
}

export function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.setTimeout(400);
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("timeout", () => (s.destroy(), resolve(false)));
    s.once("error", () => resolve(false));
  });
}

/** Read-only look at the local PGlite DB (counts only). Does not create the data dir. */
export async function readDbState(env: Record<string, string>): Promise<DbState> {
  const expected = migrationsExpected();
  if (!existsSync(pgliteDir(env))) return { initialized: false, migrationsApplied: 0, migrationsExpected: expected, companies: 0, staleItems: 0 };
  const { sql } = await import("drizzle-orm");
  const { closeDb, getDb } = await import("../../src/db/client");
  const db = await getDb();
  const count = async (query: string): Promise<number> => {
    try {
      const res = (await db.execute(sql.raw(query))) as unknown as { rows: Array<{ n: string | number }> };
      return Number(res.rows[0]?.n ?? 0);
    } catch {
      return 0;
    }
  };
  const state: DbState = {
    initialized: true,
    migrationsExpected: expected,
    migrationsApplied: await count('select count(*) as n from "drizzle"."__drizzle_migrations"'),
    companies: await count("select count(*) as n from companies"),
    staleItems: await count("select count(*) as n from stale_items"),
  };
  await closeDb();
  return state;
}
