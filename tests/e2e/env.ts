/** Shared by playwright.config.ts, scripts/e2e-server.ts and the specs. Test-only values; nothing here is a real secret. */
export const E2E_PORT_BASE = Number(process.env.E2E_PORT ?? 3320);

export const E2E_GROUPS = {
  /** tests/e2e/demo-path.spec.ts: the BRIEF's demo path on a freshly seeded database. */
  demo: { port: E2E_PORT_BASE + 1, prep: false },
  /** tests/e2e/agents.spec.ts: filing/recovery agent API contract. */
  agents: { port: E2E_PORT_BASE + 2, prep: true },
  /** replica + ui-a + ui-b specs. */
  ui: { port: E2E_PORT_BASE + 3, prep: true },
  /** a11y.spec.ts + a11y-keyboard.spec.ts: axe sweeps and the keyboard path. Own server because the owner-link setup drafts a letter. */
  a11y: { port: E2E_PORT_BASE + 4, prep: false },
} as const;
export type E2EGroup = keyof typeof E2E_GROUPS;

export const E2E_SECRETS = {
  OWNER_LINK_SECRET: "e2e-owner-link-secret-0123456789abcdef",
  MCP_TOKEN: "e2e-mcp-token-0123456789abcdef",
  ALLOWED_TEST_RECIPIENTS: "demo-recipient@example.com",
  AGENTMAIL_INBOX_ID: "escheat-agent@agentmail.test",
} as const;

export const BLOCKED_RECIPIENT = "outsider@example.org";
