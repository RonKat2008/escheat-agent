import { Inngest } from "inngest";

/**
 * Dev mode (local Inngest dev server) is used whenever no signing key is configured outside production, or when
 * INNGEST_DEV=1 outside production. INNGEST_DEV is IGNORED in production: it would disable signature verification on
 * the gate-exempt /api/inngest endpoint (security review L2). Production requires INNGEST_SIGNING_KEY / INNGEST_EVENT_KEY.
 */
export function shouldUseInngestDev(env: Record<string, string | undefined> = process.env): boolean {
  const production = env.NODE_ENV === "production" || Boolean(env.VERCEL);
  if (production) return false;
  return env.INNGEST_DEV === "1" || !env.INNGEST_SIGNING_KEY;
}

export const inngest = new Inngest({ id: "escheat-agent", isDev: shouldUseInngestDev() });

export * from "./events";
