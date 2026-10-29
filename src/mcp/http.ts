import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Db } from "@/db/client";
import { checkMcpAuth, checkMcpOrigin } from "./auth";
import { createEscheatMcpServer } from "./server";

/** Stateless Streamable HTTP handler: a fresh server + transport per request. */
export async function handleMcpRequest(req: Request, getDatabase: () => Promise<Db>): Promise<Response> {
  const origin = checkMcpOrigin(req.headers, req.url);
  if (!origin.ok) return Response.json({ error: origin.message }, { status: origin.status });
  const auth = checkMcpAuth(req.headers.get("authorization"));
  if (!auth.ok) {
    return Response.json({ error: auth.message }, { status: auth.status, headers: auth.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined });
  }
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
