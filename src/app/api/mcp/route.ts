import { getDb, migrate } from "@/db/client";
import { handleMcpRequest } from "@/mcp/http";

async function database() {
  await migrate();
  return getDb();
}

export async function GET(req: Request) {
  return handleMcpRequest(req, database);
}
export async function POST(req: Request) {
  return handleMcpRequest(req, database);
}
export async function DELETE(req: Request) {
  return handleMcpRequest(req, database);
}
