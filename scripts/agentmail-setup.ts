/**
 * One-time, explicit step: creates (or finds, via client_id idempotency) the dedicated "escheat-agent" AgentMail inbox
 * and prints its id for AGENTMAIL_INBOX_ID. The app itself never creates inboxes, and this script never lists,
 * selects or modifies any other inbox in the account.
 *   pnpm agentmail:setup
 */
import { existsSync } from "node:fs";
import { AGENTMAIL_INBOX_DISPLAY_NAME, AGENTMAIL_INBOX_USERNAME, createOrGetAgentMailInbox } from "../src/lib/outreach/agentmail";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main(): Promise<void> {
  const apiKey = process.env.AGENTMAIL_API_KEY?.trim();
  if (!apiKey) {
    console.error("AGENTMAIL_API_KEY is not set (put it in .env.local).");
    process.exit(1);
  }
  const inbox = await createOrGetAgentMailInbox(apiKey);
  console.log(`Inbox ready: ${inbox.email} (display name "${inbox.display_name ?? AGENTMAIL_INBOX_DISPLAY_NAME}", username ${AGENTMAIL_INBOX_USERNAME})`);
  console.log("\nAdd this to .env.local:\n");
  console.log(`AGENTMAIL_INBOX_ID=${inbox.inbox_id}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
