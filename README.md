# Escheat Agent

Prototype (BBS x Ramp hackathon). Automates unclaimed-property (escheatment) compliance for CA, DE and TX:
find stale checks and credits, compute legal timelines from sourced rule files, run owner outreach,
generate and file state reports against replica portals, and search for money owed back.

**Prototype. Not legal advice. Confirm filings with a qualified professional.**

## What it does

| Step | How | Where |
|---|---|---|
| Ingest | CSV (column mapping, Zod, bad rows reported), QuickBooks Online sandbox, Plaid sandbox | `src/lib/ingest`, `src/lib/integrations`, `/settings/integrations` |
| Reconcile | Checks matched to bank clears by number, then amount + date; voids, late clears, ambiguous ties flagged | `src/lib/recon` |
| Classify | Haiku 5.5 → escalate to Opus 5.5 → human review queue. Owner state is re-derived in code (Texas v. New Jersey) and overrides the model. Labeled heuristic fallback when no key | `src/lib/agents/classifier.ts` |
| Legal dates | Deterministic engine over versioned, sourced rule files (`rules/CA.json`, `DE.json`, `TX.json`); unverified inputs propagate an UNVERIFIED flag, missing ones UNKNOWN | `src/lib/rules` |
| Durable timelines | One Inngest function per item, driven by a pure state machine; the demo clock fast-forwards it | `src/lib/timeline`, `src/inngest` |
| Outreach | Due-diligence letter (statutory text from the rule file only) via Lob TEST, email via AgentMail (allowlist), voice call via Vapi (allowlist), signed single-use owner links | `src/lib/outreach`, `src/lib/letters`, `/owner/[token]` |
| Report + file | NAUPA II fixed-width writer + validator + evidence-pack PDF; Stagehand/Playwright filing agent on the REPLICA portal pauses at "Approve submission" until a human approves in the app | `src/lib/reports`, `src/lib/browser-agents`, `/replica/*` |
| Recover | Agent searches REPLICA state databases for the company's name variants and drafts a claim for approval | `src/lib/browser-agents` |
| Ask | MCP server (stdio + Streamable HTTP): exposure, stale items, deadlines, explain item, audit interest; drafts only | `src/mcp`, `docs/MCP.md` |
| Measure | 200-case eval (160 generated + 40 hand-written adversarial), stored per run | `pnpm eval`, `/eval` |

## Setup

```bash
pnpm install
cp .env.example .env.local   # every variable is optional; see the table below
pnpm seed:demo               # migrate + seed the SYNTHETIC demo company (PGlite by default)
pnpm dev                     # http://localhost:3000
npx inngest-cli@latest dev   # optional: Inngest dev server, auto-discovers /api/inngest
```

Without any keys the whole demo still runs: the classifier uses a labeled heuristic, Lob/AgentMail/Vapi
show "not configured", and the browser agents run in SCRIPTED mode (deterministic Playwright, labeled).

### Environment variables (`.env.example` lists all, with comments)

| Group | Variables |
|---|---|
| Database | `DATABASE_URL` (Neon; unset = PGlite), `PGLITE_DATA_DIR`, `DATABASE_URL_TEST` |
| Models | `ANTHROPIC_API_KEY`, `ORCHESTRATOR_MODEL` (claude-opus-5-5), `WORKER_MODEL` (claude-haiku-5-5), `STAGEHAND_MODEL` |
| Durable jobs | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_DEV` |
| Outreach | `LOB_TEST_API_KEY` (must start `test_`), `LOB_WEBHOOK_SECRET`, `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID`, `AGENTMAIL_WEBHOOK_SECRET`, `ALLOWED_TEST_RECIPIENTS`, `ALLOWED_TEST_PHONES`, `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VAPI_ASSISTANT_ID`, `OWNER_LINK_SECRET` |
| Integrations | `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_TOKEN_SECRET`, `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=sandbox` |
| Access | `APP_BASE_URL`, `APP_PASSCODE` (required in production; the app fails closed without it), `SESSION_SECRET`, `SESSION_EPOCH`, `APPROVAL_TTL_HOURS`, `MCP_TOKEN`, `MCP_ALLOWED_HOSTS`, `REPLICA_SESSION_SECRET` |
| Demo | `DEMO_ANCHOR_DATE=2026-11-01`, `DEMO_MODE`, `STALE_THRESHOLD_DAYS=180`, `ESCHEAT_OFFLINE`, `ESCHEAT_RECORD`, `AGENTS_ENABLED`, `AGENT_HEADED` |

## AgentMail setup

Outreach email is sent from one dedicated AgentMail inbox, never from any other inbox in your account.

```bash
# put AGENTMAIL_API_KEY in .env.local, then:
pnpm agentmail:setup   # creates (idempotently, client_id) or finds the "escheat-agent" inbox and prints AGENTMAIL_INBOX_ID
```

Paste the printed `AGENTMAIL_INBOX_ID` into `.env.local`. Without it email is refused as "agentmail not configured";
the app itself never creates inboxes. Recipients stay limited to `ALLOWED_TEST_RECIPIENTS`. Delivery tracking is optional:
point a webhook at `/api/webhooks/agentmail` and set `AGENTMAIL_WEBHOOK_SECRET` (Svix `whsec_...`).

## Live check

When API keys arrive, one command proves each service end to end:

```bash
pnpm smoke:live                 # prints a table: service | status | detail
pnpm smoke:live --json out.json # also writes the results as JSON
pnpm smoke:live --only lob,agentmail
pnpm smoke:live --dial          # additionally places ONE simulated call (see below)
```

Each service reports `PASS`, `FAIL` or `SKIPPED` (with the missing env vars). The exit code is non-zero only if a
configured service FAILS. Checks go through the real send paths and keep every guard (allowlists, `test_` Lob key,
in-app approval, replica-only browsers); the approval is created programmatically for a synthetic row in a throwaway
PGlite directory, never your app data or `DATABASE_URL`.

| Service | What it does |
|---|---|
| Anthropic | One tiny structured classification of a synthetic item; prints model and token counts |
| Stagehand | Runs the recovery agent in Stagehand mode against the local replica (needs `pnpm dev` running); SKIPPED if the replica is unreachable |
| Lob | Refuses unless the key starts with `test_`, then creates one TEST-mode letter to a synthetic address |
| AgentMail | Reads the configured inbox (`GET /inboxes/{AGENTMAIL_INBOX_ID}`, reports its address), then sends one email only to the FIRST address in `ALLOWED_TEST_RECIPIENTS`. SKIPPED unless `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID` and the allowlist are all set |
| Vapi | Reads the phone number (reports provider and last 4 digits only) and, if `VAPI_ASSISTANT_ID` is set, the assistant config to verify no transfer tools. No call is placed by default |
| QuickBooks | Sandbox token refresh plus a `count(*)` query. QBO has no client-credentials flow, so also set `QBO_SMOKE_REFRESH_TOKEN` and `QBO_SMOKE_REALM_ID` (from the Intuit OAuth Playground); the refresh token rotates, so update it after a run |
| Plaid | Creates a sandbox link token and a sandbox public token |
| Inngest | Checks `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` are both set, or that the dev server answers (presence only; no event is sent) |

`--dial` places one real, labeled SIMULATED call through Vapi to the first number in `ALLOWED_TEST_PHONES`
(`--dial-to <e164>` picks another number, which must still be on the allowlist). It always uses the inline assistant
with a fixed SYNTHETIC script, never a saved one. Without `--dial`, nobody is called.
`ESCHEAT_OFFLINE=1` makes the model and send checks SKIPPED, since they would only replay or fake.

## Offline mode

`ESCHEAT_OFFLINE=1` replays recorded model calls from `fixtures/cassettes/` (record them once with a key and
`ESCHEAT_RECORD=1`). A missing cassette falls back to the labeled heuristic. Lob/AgentMail become local fakes whose
results say "Offline mode: nothing was sent"; they never claim mail or email went out.

## Running the demo (matches the pitch video)

1. `pnpm seed:demo && pnpm dev`, open `/dashboard`: **$61,915.00** across **47** stale items, CA 21 ($28,410) ·
   TX 15 ($19,862) · DE 11 ($13,643). "Stale" is a business threshold (180 days), not law.
2. Open check **#10482** (Bayline Electric, $2,340.00): `/items?item=…` shows the legal timeline, each date with its
   rule path, version and source links, and UNVERIFIED until you approve the rule at `/rules`.
3. Draft its letter → `/approvals` shows exactly what will be mailed → Approve → Send (Lob TEST PDF when the key is
   set). Draft the email and the call the same way. The owner page records the owner's answer; marking it paid is
   an authenticated in-app step.
4. Header **Demo date** → +1y: items move through `dd_pending` → `to_report`. `/reports` → Generate CA → validated
   NAUPA file + evidence pack.
5. Run filing agent: it logs into the REPLICA CA portal, uploads, checks totals, and **pauses at "Approve
   submission"**. Approve in the app → it submits and records the confirmation number.
6. `/recoveries` → Run recovery agent → finds **$1,180.00** held in TX for "NORTHWIND FIXTURES INC" → approve →
   file claim.
7. Ask Claude via MCP: "What do we owe in unclaimed property, and where?" (setup in `docs/MCP.md`).
8. `/eval` shows the stored eval run, with the classification method stated up front.

`pnpm agent:file CA` and `pnpm agent:recover` drive the same agents from the CLI.

Scripts: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm e2e` (Playwright), `pnpm verify`
(typecheck + lint + test + build + e2e), `pnpm db:generate` (new migration after editing `src/db/schema.ts`).

## Demo reset

`pnpm seed:demo` resets everything to the demo starting state in one command (idempotent): migrate, wipe,
seed the SYNTHETIC company/ledger/clears/eval cases, sync rule files to the DB, run stale detection
(47 items / $61,915.00; CA 21, TX 15, DE 11), reset the demo clock to the anchor, run the eval once
(labeled heuristic when there is no `ANTHROPIC_API_KEY`), and clear outreach, approvals, reports,
recoveries, agent runs and replica tables. It prints a summary block and fails if the invariants break.
Stop the dev server first when using the default PGlite directory (PGlite is single-process), or set
`PGLITE_DATA_DIR` to a separate directory.

## End-to-end tests

`pnpm e2e` starts three isolated dev servers (each re-seeds its own PGlite directory, see
`scripts/e2e-server.ts`): `demo` runs `tests/e2e/demo-path.spec.ts` (the full demo path in a real browser),
`agents` the browser-agent API contract, `ui` the replica/UI specs. Provider keys are scrubbed, so Lob/AgentMail
show their "not configured" states. `pnpm e2e:offline` re-runs the demo path with `ESCHEAT_OFFLINE=1`.
Set `E2E_SHOTS_DIR=<dir>` to also capture visual-QA screenshots at 375/1024/1440.

> pnpm 12 note: if a tool fails with `spawn ENOEXEC`, the `pnpm` shim has no shebang; put a one-line
> `#!/bin/sh` wrapper that execs it earlier on `PATH`.

## Database modes

- **PGlite (default).** With `DATABASE_URL` unset, `getDb()` uses a file-backed PGlite at `.data/pglite`
  (gitignored). Tests use an in-memory PGlite with migrations applied (`createTestDb()`).
- **Neon.** Set `DATABASE_URL` and the same code uses `drizzle-orm/neon-serverless`.

## Safety rules

1. The LLM never decides the law. Legal dates come from versioned rule files plus deterministic code.
2. Every rule value carries an official `source_url` and a `verified` flag; unverified values show an UNVERIFIED badge.
3. No real state is ever filed with or searched. Agents run only against `/replica/*`.
4. Letters via Lob TEST mode only; email only to `ALLOWED_TEST_RECIPIENTS`; calls only to `ALLOWED_TEST_PHONES`.
5. Every irreversible step needs in-app human approval, enforced server-side.
6. Synthetic data only (see `fixtures/SYNTHETIC.md`).
7. Secrets live in `.env.local`; `.env.example` lists every variable.
8. Missing keys show an honest "not configured" state, never fake data.

## Limitations (read before showing anyone)

- **Rules are unverified.** Every value in `rules/*.json` was researched from official sources (statutes,
  controller/comptroller handbooks; see `docs/rules-research.md`) but carries `verified: false` until a human
  approves it at `/rules`. Some values are `null` with a TODO (e.g. DE aggregate threshold, DE weekend roll-forward,
  TX required letter language); the engine shows UNKNOWN for anything that depends on them.
- **Replica portals only.** `/replica/*` imitate a holder-filing portal and an unclaimed-property search. They are
  not real state systems; the browser agents are fenced to them at the URL, network and DNS level.
- **Synthetic data only.** Northwind Fixtures, Inc. and every payee, address and amount are generated
  (`fixtures/SYNTHETIC.md`). The holder TIN is always `000000000`.
- **Eval numbers without a key are a heuristic baseline**, labeled as such on `/eval`; they are not model accuracy.
- **Browser agents need a local Chromium**, so on Vercel they are disabled unless `AGENTS_ENABLED=1` on a host
  that can run Playwright. PGlite is single-process; use Neon (`DATABASE_URL`) for any deployment.
- **NAUPA format:** PROPADD, securities and tangible records are not generated; a few spec positions were inferred
  (`docs/naupa-format.md`). CA's notice report uses report type `A`, which is unconfirmed.
- Security review and remediation notes: `docs/SECURITY-REVIEW.md`.
