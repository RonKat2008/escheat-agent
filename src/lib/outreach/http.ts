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

export interface ErrorInfo {
  error: string;
  status: number;
  /** Extra response fields (code, problems, ...). */
  extra: Record<string, unknown>;
}

/** Pure mapping of outreach-lane errors to the agreed message, status code and extra fields. */
export function errorInfo(err: unknown): ErrorInfo {
  const info = (error: string, status: number, extra: Record<string, unknown> = {}): ErrorInfo => ({ error, status, extra });

  if (err instanceof ZodError) {
    return info("Invalid request", 400, { issues: err.issues.map((i) => ({ path: i.path, message: i.message })) });
  }
  if (err instanceof ApprovalRequiredError) {
    return info(err.message, err.reason === "consumed" ? 409 : 403, { code: "approval_required", reason: err.reason });
  }
  if (err instanceof ReviewedContentChangedError) return info(err.message, 409, { code: err.code });
  if (err instanceof OutcomeUnknownError) return info(err.message, 409, { code: "outcome_unknown", needsReconciliation: true });
  if (err instanceof ApprovalAlreadyConsumedError) return info(err.message, 409, { code: "approval_consumed" });
  if (err instanceof RecipientNotAllowedError) return info(err.message, 403, { code: "recipient_not_allowed" });
  if (err instanceof LiveLobKeyError) return info(err.message, 403, { code: "live_key_refused" });
  if (err instanceof OutreachNotConfiguredError) {
    return info(`${err.service} not configured`, 501, { code: "not_configured", service: err.service, missing: err.missing });
  }
  if (err instanceof OwnerTokenConfigError) return info(err.message, 501, { code: "not_configured", service: "owner_link" });
  if (err instanceof OutreachNotFoundError) return info(err.message, 404, { code: "not_found" });
  if (err instanceof OutreachStateError) return info(err.message, 409, { code: err.reason });
  if (err instanceof OutreachNotReadyError) return info(err.message, 422, { code: "not_ready", problems: err.problems });
  if (err instanceof VoiceAgentUnsafeError) return info(err.message, 422, { code: "voice_agent_unsafe", problems: err.problems });
  if (err instanceof OutreachProviderError) return info(err.message, 502, { code: "provider_error", service: err.service });
  console.error("[outreach] unexpected error", err);
  return info("Internal error", 500);
}

/** Map outreach-lane errors to { error } JSON responses with the agreed status codes. */
export function errorResponse(err: unknown): NextResponse {
  const { error, status, extra } = errorInfo(err);
  return NextResponse.json({ error, ...extra }, { status });
}
