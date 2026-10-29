/** Escheat MCP server over stdio. stdout is protocol-only: log to stderr. Run: pnpm mcp:stdio */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closeDb, getDb, migrate } from "../src/db/client";
import { createEscheatMcpServer } from "../src/mcp/server";

async function main() {
  const mode = await migrate();
  const db = await getDb();
  const server = createEscheatMcpServer(db);
  await server.connect(new StdioServerTransport());
  console.error(`[escheat-mcp] stdio server ready (db: ${mode})`);
  const shutdown = () => {
    void server.close().finally(() => closeDb().finally(() => process.exit(0)));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[escheat-mcp] fatal:", err);
  process.exit(1);
});
