/** Typed errors for the outreach lane. HTTP mapping lives in http.ts. */

/** A required key / config value is missing. The UI shows "<service> not configured". Never faked. */
export class OutreachNotConfiguredError extends Error {
  constructor(
    public readonly service: "lob" | "agentmail" | "vapi" | "webhook",
    public readonly missing: string[],
  ) {
    super(`${service} is not configured (missing ${missing.join(", ")}).`);
    this.name = "OutreachNotConfiguredError";
  }
}

export class OutreachNotFoundError extends Error {
  constructor(what: string, id: string) {
    super(`${what} ${id} not found.`);
    this.name = "OutreachNotFoundError";
  }
}

export class OutreachStateError extends Error {
  constructor(
    public readonly reason: "already_sent" | "wrong_channel" | "locked",
    message: string,
  ) {
    super(message);
    this.name = "OutreachStateError";
  }
}

/** The draft cannot be approved or sent yet (for example, required state language unknown). */
export class OutreachNotReadyError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Outreach is not ready: ${problems.join("; ")}`);
    this.name = "OutreachNotReadyError";
  }
}

/** Provider statuses that PROVE the request was rejected before doing anything (safe to release the approval). */
export function isDefinitelyNotExecutedStatus(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 409;
}

export function statusOf(e: unknown): number | undefined {
  const x = e as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } } | null;
  for (const v of [x?.status, x?.statusCode, x?.response?.status]) if (typeof v === "number") return v;
  return undefined;
}

export class OutreachProviderError extends Error {
  /** True only when the provider's answer proves nothing was sent (see withApproval, security review M4). */
  readonly sideEffectNotPerformed: boolean;
  constructor(
    public readonly service: "lob" | "agentmail" | "vapi",
    message: string,
    public readonly status?: number,
  ) {
    super(`${service} request failed: ${message}`);
    this.name = "OutreachProviderError";
    this.sideEffectNotPerformed = isDefinitelyNotExecutedStatus(status);
  }
}
