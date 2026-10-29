/** Typed errors for the outreach lane. HTTP mapping lives in http.ts. */

/** A required key / config value is missing. The UI shows "<service> not configured". Never faked. */
export class OutreachNotConfiguredError extends Error {
  constructor(
    public readonly service: "lob" | "resend" | "elevenlabs" | "webhook",
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

export class OutreachProviderError extends Error {
  constructor(
    public readonly service: "lob" | "resend" | "elevenlabs",
    message: string,
  ) {
    super(`${service} request failed: ${message}`);
    this.name = "OutreachProviderError";
  }
}
