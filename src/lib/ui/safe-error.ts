/**
 * Text for a route error boundary. `error.message` can carry raw SQL, row values, tenant ids or ZodError JSON, so it is
 * never shown: the user gets the fallback sentence plus Next's opaque `digest`, which matches the server log line that
 * holds the real details.
 */
export function safeErrorMessage(error: { message?: string; digest?: string } | null | undefined, fallback: string): string {
  const digest = error?.digest?.trim();
  return digest ? `${fallback} Reference ${digest}.` : fallback;
}
