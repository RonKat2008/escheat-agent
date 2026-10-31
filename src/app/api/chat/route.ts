import { NextResponse } from "next/server";
import { authErrorResponse, requireSession, type Session } from "@/lib/auth/session";
import { chatAvailability, runChatTurn } from "@/lib/chat/agent";
import { ChatRequestSchema, encodeEvent, type ChatEvent } from "@/lib/chat/protocol";
import { consumeChatTurn } from "@/lib/chat/rate-limit";
import { getOutreachDb } from "@/lib/outreach/db";
import { resolveCompanyId } from "@/lib/pipeline/company";

const MAX_BODY_BYTES = 256 * 1024;

const problem = (status: number, code: string, error: string, headers?: HeadersInit) => NextResponse.json({ error, code }, { status, headers });

/**
 * Streams one chat turn as NDJSON (one ChatEvent per line). Session-guarded; CSRF is enforced by src/proxy.ts.
 * The model can read, draft and simulate. It can never approve, send or file (see src/lib/chat/tools).
 */
export async function POST(request: Request): Promise<Response> {
  let session: Session;
  try {
    session = await requireSession(request);
  } catch (e) {
    return authErrorResponse(e);
  }

  const availability = chatAvailability();
  if (availability === "not_configured") {
    return problem(503, "not_configured", "Chat needs ANTHROPIC_API_KEY. Add it to .env.local and restart the server.");
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return problem(413, "invalid_request", "Request too large. Start a new chat.");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return problem(400, "invalid_request", "Request body must be JSON");
  }
  const parsed = ChatRequestSchema.safeParse(json);
  if (!parsed.success) {
    return problem(400, "invalid_request", parsed.error.issues.map((i) => i.message).join("; "));
  }

  const limit = consumeChatTurn(session.id);
  if (!limit.ok) {
    return problem(429, "rate_limited", `Too many messages. Try again in ${limit.retryAfterSec}s.`, { "retry-after": String(limit.retryAfterSec) });
  }

  const db = await getOutreachDb();
  const companyId = await resolveCompanyId(db);
  if (!companyId) return problem(404, "no_company", "No company. Run pnpm seed:demo.");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (e: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(e)));
        } catch {
          open = false; // client went away
        }
      };
      await runChatTurn({ db, companyId, messages: parsed.data.messages, emit, signal: request.signal });
      if (open) controller.close();
      open = false;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-content-type-options": "nosniff",
      "x-accel-buffering": "no",
    },
  });
}
