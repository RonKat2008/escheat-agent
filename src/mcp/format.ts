import { DISCLAIMER } from "@/lib/disclaimer";

export const UNVERIFIED_NOTE =
  "UNVERIFIED: one or more underlying state rules have not been human-verified against the official source. Treat dates and amounts that depend on them as provisional.";

/** Standard tool result: a human summary, the disclaimer, and the full JSON payload. */
export function toolResult(summary: string, data: unknown, opts: { unverified?: boolean } = {}) {
  const parts = [summary, ...(opts.unverified ? [UNVERIFIED_NOTE] : []), DISCLAIMER, "```json\n" + JSON.stringify(data, null, 2) + "\n```"];
  return { content: [{ type: "text" as const, text: parts.join("\n\n") }] };
}

export function toolError(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: `${message}\n\n${DISCLAIMER}` }] };
}
