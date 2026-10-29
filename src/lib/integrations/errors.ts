export class IntegrationError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

/** Thrown when required credentials are not present. Routes map this to HTTP 501. */
export class NotConfiguredError extends IntegrationError {
  constructor(
    readonly provider: "qbo" | "plaid",
    message: string,
  ) {
    super(message, 501);
    this.name = "NotConfiguredError";
  }
}

export const QBO_NOT_CONFIGURED = "QuickBooks sandbox not configured";
export const PLAID_NOT_CONFIGURED = "Plaid sandbox not configured";
