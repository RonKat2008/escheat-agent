import { timingSafeEqual } from "@/lib/crypto";

export type McpAuthResult = { ok: true; warning?: string } | { ok: false; status: 401 | 503; message: string };

/** Bearer-token check for the HTTP endpoint. Unset MCP_TOKEN => 503, except in development (allowed with a warning). */
export function checkMcpAuth(
  authorization: string | null,
  env: { MCP_TOKEN?: string; NODE_ENV?: string } = process.env,
): McpAuthResult {
  const token = env.MCP_TOKEN?.trim();
  if (!token) {
    if (env.NODE_ENV === "development") return { ok: true, warning: "MCP_TOKEN not set: allowing unauthenticated MCP access in development" };
    return { ok: false, status: 503, message: "MCP_TOKEN not configured" };
  }
  const m = /^Bearer (.+)$/.exec(authorization ?? "");
  if (!m || !timingSafeEqual(m[1]!, token)) return { ok: false, status: 401, message: "Unauthorized" };
  return { ok: true };
}
