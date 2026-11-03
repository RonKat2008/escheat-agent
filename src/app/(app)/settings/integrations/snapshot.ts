import { getDb } from "@/db/client";
import { shouldUseInngestDev } from "@/inngest/client";
import {
  allowedPhones,
  allowedRecipients,
  getEnv,
  hasAgentMail,
  hasAnthropic,
  hasInngestKeys,
  hasLob,
  hasVapi,
  isOffline,
} from "@/lib/env";
import { plaidConfig, qboConfig } from "@/lib/integrations/config";
import { resolveCompanyId } from "@/lib/integrations/http";
import { drizzleRawStore } from "@/lib/integrations/store";
import { LOB_TEST_PREFIX } from "@/lib/outreach/allowlist";
import { MIN_SECRET_LENGTH } from "@/lib/outreach/tokens";
import type { OwnerLinkState } from "@/lib/settings/operator-copy";
import type { IntegrationSnapshot } from "@/components/viz/connection-diagram/model";

export interface SettingsData {
  companyId: string | null;
  snapshot: IntegrationSnapshot;
  /** Owner-link readiness (R3-14): booleans only; the UI turns them into operator language. */
  ownerLinks: OwnerLinkState;
}

/**
 * Server-only read of what is configured, from the same env helpers and stored connections the send paths use
 * (src/lib/env.ts, /api/integrations/status). Returns booleans, counts and the first allowlisted test recipient (the
 * address an email draft starts with). Never a key, token or secret value.
 */
export async function loadSettingsData(): Promise<SettingsData> {
  const env = getEnv();
  const db = await getDb();
  const companyId = (await resolveCompanyId(db, null)) ?? null;
  const raw = drizzleRawStore(db);
  const [qbo, plaid] = companyId ? await Promise.all([raw.get(companyId, "qbo"), raw.get(companyId, "plaid")]) : [undefined, undefined];
  const recipients = allowedRecipients(env);
  const lobKey = env.LOB_TEST_API_KEY;
  return {
    companyId,
    snapshot: {
      offline: isOffline(env),
      qbo: { configured: Boolean(qboConfig()), connected: Boolean(qbo?.accessTokenEnc) },
      plaid: { configured: Boolean(plaidConfig()), connected: Boolean(plaid?.accessTokenEnc) },
      lob: { keyPresent: hasLob(env), testKey: Boolean(lobKey && lobKey.startsWith(LOB_TEST_PREFIX) && lobKey.length > LOB_TEST_PREFIX.length) },
      agentmail: { configured: hasAgentMail(env), testRecipient: recipients[0] ?? null, allowlistCount: recipients.length },
      vapi: { configured: hasVapi(env), allowlistCount: allowedPhones(env).length },
      anthropic: { configured: hasAnthropic(env) },
      inngest: { keys: hasInngestKeys(env), devMode: shouldUseInngestDev() },
    },
    ownerLinks: { secretSet: (env.OWNER_LINK_SECRET?.length ?? 0) >= MIN_SECRET_LENGTH, baseUrlSet: Boolean(env.APP_BASE_URL) },
  };
}
