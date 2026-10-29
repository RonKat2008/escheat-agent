import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";

export interface CassetteRequest {
  model: string;
  system?: unknown;
  messages: unknown;
  tools?: unknown;
  output_config?: unknown;
}

export interface Cassette {
  version: 1;
  agent: string;
  hash: string;
  recordedAt: string;
  request: CassetteRequest;
  response: Anthropic.Message;
}

let cassetteDirOverride: string | undefined;

/** Tests point this at a temp dir. Pass undefined to reset. */
export function setCassetteDir(dir: string | undefined): void {
  cassetteDirOverride = dir;
}

export function cassetteDir(): string {
  return cassetteDirOverride ?? path.join(process.cwd(), "fixtures", "cassettes");
}

/** JSON with recursively sorted keys and undefined dropped, so equal requests hash equal. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function requestHash(req: CassetteRequest): string {
  const { model, system, messages, tools, output_config } = req;
  return createHash("sha256").update(canonicalize({ model, system, messages, tools, output_config })).digest("hex");
}

/** Agent names become directory names; keep them safe. */
function safeSegment(agent: string): string {
  return agent.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function cassettePath(agent: string, hash: string): string {
  return path.join(cassetteDir(), safeSegment(agent), `${hash}.json`);
}

export function readCassette(agent: string, hash: string): Cassette | undefined {
  const file = cassettePath(agent, hash);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8")) as Cassette;
}

export function writeCassette(agent: string, req: CassetteRequest, response: Anthropic.Message): string {
  const hash = requestHash(req);
  const file = cassettePath(agent, hash);
  mkdirSync(path.dirname(file), { recursive: true });
  const cassette: Cassette = {
    version: 1,
    agent,
    hash,
    recordedAt: new Date().toISOString(),
    request: JSON.parse(canonicalize(req)) as CassetteRequest,
    response,
  };
  writeFileSync(file, `${JSON.stringify(cassette, null, 2)}\n`);
  return file;
}
