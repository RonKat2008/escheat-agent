/** Pure text formatting for `pnpm setup` and `pnpm run doctor`. Only names, counts and hints; never env values. */
import { LOCAL_SECRET_NAMES } from "./env-file";
import { integrationStatuses } from "./integrations";

export const MIN_NODE_MAJOR = 20;
export const MIN_NODE_MINOR = 9;

export interface Check {
  ok: boolean;
  label: string;
  /** A fix-it hint, shown only when the check fails. */
  hint?: string;
}

export function checkNodeVersion(version: string): Check {
  const m = /^v?(\d+)\.(\d+)/.exec(version);
  const major = m ? Number(m[1]) : 0;
  const minor = m ? Number(m[2]) : 0;
  const ok = major > MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR);
  return {
    ok,
    label: `Node ${version.replace(/^v/, "")} (need ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}+)`,
    hint: ok ? undefined : "Install Node 20.9 or newer (for example `nvm install 22`), then rerun.",
  };
}

export function checkPnpmVersion(version: string | null): Check {
  return version
    ? { ok: true, label: `pnpm ${version}` }
    : { ok: false, label: "pnpm not found", hint: "Install pnpm (`corepack enable`), then rerun." };
}

export interface DbState {
  /** false = the PGlite data directory does not exist yet. */
  initialized: boolean;
  migrationsApplied: number;
  migrationsExpected: number;
  companies: number;
  staleItems: number;
}

export function checkDbState(s: DbState): Check[] {
  if (!s.initialized) {
    return [{ ok: false, label: "Database not created yet", hint: "Run `pnpm run setup` (it migrates and seeds)." }];
  }
  const migrated = s.migrationsApplied >= s.migrationsExpected;
  const seeded = s.companies > 0 && s.staleItems > 0;
  return [
    { ok: migrated, label: `Migrations applied (${s.migrationsApplied}/${s.migrationsExpected})`, hint: "Run `pnpm db:migrate`." },
    {
      ok: seeded,
      label: seeded ? `Demo seed present (${s.staleItems} stale items)` : "Demo seed missing",
      hint: "Run `pnpm seed:demo` (resets to the demo starting state).",
    },
  ];
}

function line(c: Check): string {
  return c.ok ? `  [ok]   ${c.label}` : `  [todo] ${c.label}${c.hint ? `\n         -> ${c.hint}` : ""}`;
}

export function formatChecks(title: string, checks: Check[]): string {
  return [title, ...checks.map(line)].join("\n");
}

/** Env report by NAME only: the demo needs nothing; each optional integration lists the vars that turn it on. */
export function formatEnvReport(env: Record<string, string>): string {
  const rows = integrationStatuses(env).map((i) => {
    if (i.state === "configured") return `  [on]   ${i.label}`;
    const how = i.state === "partial" ? `still unset: ${i.missing.join(", ")}` : `set ${i.required.join(" + ")}`;
    return `  [off]  ${i.label}: not configured (${how})\n         without it: ${i.fallback}`;
  });
  const secrets = LOCAL_SECRET_NAMES.map((n) => `${n} ${env[n] ? "set" : "unset"}`).join(", ");
  return ["Optional integrations (the demo needs none of these):", ...rows, `Local secrets: ${secrets}`].join("\n");
}

export function formatQuickStart(port = 3000): string {
  return [
    "What works offline, with zero keys:",
    "  dashboard, items and legal timelines, rules, approvals, reports (NAUPA + evidence pack),",
    "  replica filing and recovery agents (scripted), eval (heuristic baseline), demo time travel.",
    "",
    "Start the demo:",
    "  pnpm dev",
    `  then open http://localhost:${port} and click "Open the demo"`,
    "",
    "Check anytime: pnpm run doctor",
  ].join("\n");
}
