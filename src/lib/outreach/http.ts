import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApprovalAlreadyConsumedError, ApprovalRequiredError, OutcomeUnknownError, ReviewedContentChangedError } from "@/lib/approvals";
import { LiveLobKeyError, RecipientNotAllowedError } from "./allowlist";
import {
  OutreachNotConfiguredError,
  OutreachNotFoundError,
  OutreachNotReadyError,
  OutreachProviderError,
  OutreachStateError,
} from "./errors";
import { OwnerTokenConfigError } from "./tokens";
import { VoiceAgentUnsafeError } from "./voice";

/** Map outreach-lane errors to { error } JSON responses with the agreed status codes. */
export function errorResponse(err: unknown): NextResponse {
  const body = (error: string, status: number, extra: Record<string, unknown> = {}) =>
    NextResponse.json({ error, ...extra }, { status });

  if (err instanceof ZodError) {
    return body("Invalid request", 400, { issues: err.issues.map((i) => ({ path: i.path, message: i.message })) });
  }
  if (err instanceof ApprovalRequiredError) {
    return body(err.message, err.reason === "consumed" ? 409 : 403, { code: "approval_required", reason: err.reason });
  }
  if (err instanceof ReviewedContentChangedError) return body(err.message, 409, { code: err.code });
  if (err instanceof OutcomeUnknownError) return body(err.message, 409, { code: "outcome_unknown", needsReconciliation: true });
  if (err instanceof ApprovalAlreadyConsumedError) return body(err.message, 409, { code: "approval_consumed" });
  if (err instanceof RecipientNotAllowedError) return body(err.message, 403, { code: "recipient_not_allowed" });
  if (err instanceof LiveLobKeyError) return body(err.message, 403, { code: "live_key_refused" });
  if (err instanceof OutreachNotConfiguredError) {
    return body(`${err.service} not configured`, 501, { code: "not_configured", service: err.service, missing: err.missing });
  }
  if (err instanceof OwnerTokenConfigError) return body(err.message, 501, { code: "not_configured", service: "owner_link" });
  if (err instanceof OutreachNotFoundError) return body(err.message, 404, { code: "not_found" });
  if (err instanceof OutreachStateError) return body(err.message, 409, { code: err.reason });
  if (err instanceof OutreachNotReadyError) return body(err.message, 422, { code: "not_ready", problems: err.problems });
  if (err instanceof VoiceAgentUnsafeError) return body(err.message, 422, { code: "voice_agent_unsafe", problems: err.problems });
  if (err instanceof OutreachProviderError) return body(err.message, 502, { code: "provider_error", service: err.service });
  console.error("[outreach] unexpected error", err);
  return body("Internal error", 500);
}
