import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { declaredNames, effectiveEnv, ensureEnvFile, fillEmptySecrets, parseEnv } from "./env-file";
import { INTEGRATIONS, integrationStatuses } from "./integrations";
import { checkDbState, checkNodeVersion, checkPnpmVersion, formatChecks, formatEnvReport } from "./report";

const SENTINEL = "sk-test-SENTINEL-do-not-print-0123456789";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "escheat-setup-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ensureEnvFile", () => {
  it("creates the target from the example when missing", () => {
    const example = path.join(dir, ".env.example");
    const target = path.join(dir, ".env.local");
    writeFileSync(example, "A=1\n");
    expect(ensureEnvFile(example, target)).toBe("created");
    expect(readFileSync(target, "utf8")).toBe("A=1\n");
  });

  it("never overwrites an existing target", () => {
    const example = path.join(dir, ".env.example");
    const target = path.join(dir, ".env.local");
    writeFileSync(example, "A=1\n");
    writeFileSync(target, `ANTHROPIC_API_KEY=${SENTINEL}\n`);
    expect(ensureEnvFile(example, target)).toBe("exists");
    expect(readFileSync(target, "utf8")).toBe(`ANTHROPIC_API_KEY=${SENTINEL}\n`);
  });

  it("reports a missing example without creating anything", () => {
    expect(ensureEnvFile(path.join(dir, "nope"), path.join(dir, ".env.local"))).toBe("no-example");
  });
});

describe("fillEmptySecrets", () => {
  const gen = () => "generated-secret-value";

  it("fills only empty secrets and reports names", () => {
    const { text, filled } = fillEmptySecrets("OWNER_LINK_SECRET=\nMCP_TOKEN=\nOTHER=\n", undefined, gen);
    expect(filled).toEqual(["OWNER_LINK_SECRET", "MCP_TOKEN"]);
    expect(text).toBe("OWNER_LINK_SECRET=generated-secret-value\nMCP_TOKEN=generated-secret-value\nOTHER=\n");
  });

  it("leaves existing values untouched", () => {
    const input = `OWNER_LINK_SECRET=${SENTINEL}\nMCP_TOKEN=\n`;
    const { text, filled } = fillEmptySecrets(input, undefined, gen);
    expect(filled).toEqual(["MCP_TOKEN"]);
    expect(text).toContain(`OWNER_LINK_SECRET=${SENTINEL}`);
  });

  it("is idempotent: a second pass changes nothing", () => {
    const first = fillEmptySecrets("OWNER_LINK_SECRET=\n", ["OWNER_LINK_SECRET"], gen);
    const second = fillEmptySecrets(first.text, ["OWNER_LINK_SECRET"], () => "different");
    expect(second.filled).toEqual([]);
    expect(second.text).toBe(first.text);
  });

  it("appends a secret that is absent and treats empty quotes as empty", () => {
    expect(fillEmptySecrets("A=1", ["MCP_TOKEN"], gen).text).toBe("A=1\nMCP_TOKEN=generated-secret-value\n");
    expect(fillEmptySecrets('MCP_TOKEN=""\n', ["MCP_TOKEN"], gen).text).toBe("MCP_TOKEN=generated-secret-value\n");
  });

  it("generates 16+ char random secrets by default", () => {
    const a = fillEmptySecrets("", ["OWNER_LINK_SECRET"]).text;
    const b = fillEmptySecrets("", ["OWNER_LINK_SECRET"]).text;
    expect((parseEnv(a).OWNER_LINK_SECRET ?? "").length).toBeGreaterThanOrEqual(16);
    expect(a).not.toBe(b);
  });
});

describe(".env.example", () => {
  const example = readFileSync(path.join(process.cwd(), ".env.example"), "utf8");

  it("declares every variable an integration needs", () => {
    const names = new Set(declaredNames(example));
    for (const i of INTEGRATIONS) for (const n of i.required) expect(names, n).toContain(n);
  });

  it("has no empty active assignments other than the generated secrets", () => {
    const empty = Object.entries(parseEnv(example)).filter(([, v]) => v === "").map(([k]) => k);
    expect(empty.sort()).toEqual(["MCP_TOKEN", "OWNER_LINK_SECRET"]);
  });
});

describe("doctor output", () => {
  it("lists integration variable names and never values", () => {
    const env = effectiveEnv({ ANTHROPIC_API_KEY: SENTINEL, LOB_TEST_API_KEY: "", OWNER_LINK_SECRET: SENTINEL }, {});
    const out = formatEnvReport(env);
    expect(out).not.toContain(SENTINEL);
    expect(out).toContain("LOB_TEST_API_KEY");
    expect(out).toContain("AGENTMAIL_API_KEY");
    expect(out).toContain("OWNER_LINK_SECRET set");
    expect(out).toContain("MCP_TOKEN unset");
  });

  it("marks configured, partial and missing integrations", () => {
    const byId = Object.fromEntries(integrationStatuses({ ANTHROPIC_API_KEY: "x", PLAID_CLIENT_ID: "x" }).map((s) => [s.id, s]));
    expect(byId.anthropic?.state).toBe("configured");
    expect(byId.plaid?.state).toBe("partial");
    expect(byId.plaid?.missing).toEqual(["PLAID_SECRET"]);
    expect(byId.lob?.state).toBe("not configured");
  });

  it("lets non-empty process env override the file, ignoring empty values", () => {
    expect(effectiveEnv({ A: "file", B: "file" }, { A: "shell", B: "" })).toEqual({ A: "shell", B: "file" });
  });
});

describe("checks", () => {
  it("enforces the minimum Node version", () => {
    expect(checkNodeVersion("v22.1.0").ok).toBe(true);
    expect(checkNodeVersion("v20.9.0").ok).toBe(true);
    expect(checkNodeVersion("v20.8.1").ok).toBe(false);
    expect(checkNodeVersion("v18.19.0").hint).toMatch(/Node 20/);
  });

  it("flags a missing pnpm with a hint", () => {
    expect(checkPnpmVersion(null).ok).toBe(false);
    expect(checkPnpmVersion("12.8.1").ok).toBe(true);
  });

  it("gives fix-it hints for an unmigrated or unseeded database", () => {
    expect(checkDbState({ initialized: false, migrationsApplied: 0, migrationsExpected: 16, companies: 0, staleItems: 0 })[0]?.hint).toMatch(/run setup|pnpm run setup|pnpm setup/);
    const [migrated, seeded] = checkDbState({ initialized: true, migrationsApplied: 16, migrationsExpected: 16, companies: 0, staleItems: 0 });
    expect(migrated?.ok).toBe(true);
    expect(seeded?.ok).toBe(false);
    expect(formatChecks("t", seeded ? [seeded] : [])).toContain("pnpm seed:demo");
  });
});
