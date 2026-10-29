import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Db } from "@/db/client";
import { checkMcpAuth } from "./auth";
import { createEscheatMcpServer } from "./server";

/** Stateless Streamable HTTP handler: a fresh server + transport per request. */
export async function handleMcpRequest(req: Request, getDatabase: () => Promise<Db>): Promise<Response> {
  const auth = checkMcpAuth(req.headers.get("authorization"));
  if (!auth.ok) {
    return Response.json({ error: auth.message }, { status: auth.status, headers: auth.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined });
  }
  if (auth.warning) console.warn(`[escheat-mcp] ${auth.warning}`);
  const server = createEscheatMcpServer(await getDatabase());
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } catch (e) {
    console.error("[escheat-mcp] request failed:", e);
    return Response.json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }, { status: 500 });
  }
}
