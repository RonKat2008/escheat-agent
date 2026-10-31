# Escheat Agent

**Every uncashed check is a legal clock. Escheat Agent watches all of them.**

Unclaimed-property (escheatment) compliance still runs on spreadsheets, paper letters and state portals. Escheat Agent
reads a company's ledger, finds the stale checks and credits, computes each state's legal deadlines from sourced rule
files, reaches the owners, generates the state report, and files it against a replica portal. It stops for a human
approval before anything that cannot be undone. California, Delaware and Texas. BBS x Ramp hackathon prototype.

**Prototype. Not legal advice. Confirm filings with a qualified professional.**

The pitch in one line: **the model reads, the code decides the law, and a person approves every irreversible step.**

- **Deterministic law.** Legal dates come from versioned rule files (`rules/*.json`) with official source URLs and a
  `verified` flag, run by plain code. The model never decides a date.
- **Human gate, enforced server-side.** Letters, emails, calls, report filing, claims and rule approvals all need an
  in-app approval. The chat assistant has no tool that can approve anything.
- **Test mode and replicas only.** Lob TEST letters, allowlisted email and phone recipients, and browser agents fenced to
  `/replica/*`. Nothing real is mailed, called or filed.
- **Honest when offline or unconfigured.** Missing keys show "not configured", never fake data.

## Screenshots

Screenshots are not committed. The paths below are where they are expected; generate them with
`E2E_SHOTS_DIR=docs/screenshots pnpm e2e` (the demo spec writes `<name>-375.png`, `-1024.png` and `-1440.png` for each page).

| Surface | Route | Expected files |
|---|---|---|
| Marketing home | `/` | `docs/screenshots/marketing-home-*.png` (not produced by the e2e spec; capture by hand) |
| Dashboard | `/dashboard` | `docs/screenshots/dashboard-*.png` |
| Item timeline drawer | `/items?item=10482` | `docs/screenshots/item-drawer-*.png` |
| Approvals | `/approvals` | `docs/screenshots/approvals-*.png` |
| Reports | `/reports?state=CA` | `docs/screenshots/reports-*.png` |
| Recoveries | `/recoveries` | `docs/screenshots/recoveries-*.png` |
| Agent runs | `/runs` | `docs/screenshots/runs-*.png` |
| Eval | `/eval` | `docs/screenshots/eval-*.png` |
| Chat (generative UI) | `/chat` | `docs/screenshots/chat-*.png` (capture by hand; needs `ANTHROPIC_API_KEY`) |

## Quickstart

Requires Node and pnpm 12 (`packageManager` in `package.json`).

```bash
pnpm install
cp .env.example .env.local   # every variable is optional; see "Live services" below
pnpm seed:demo               # migrate + seed the SYNTHETIC demo company (PGlite by default)
pnpm dev                     # http://localhost:3000
npx inngest-cli@latest dev   # optional: Inngest dev server, auto-discovers /api/inngest
```

Without any keys the whole demo still runs except `/chat`: the classifier uses a labeled heuristic, Lob, AgentMail and
Vapi show "not configured", and the browser agents run in SCRIPTED mode (deterministic Playwright, labeled).
Chat needs `ANTHROPIC_API_KEY`.

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
| Ask (chat) | `/chat`: Claude answers from 17 server-side tools and renders each result as an interactive card (generative UI); drafts only | `src/lib/chat`, `src/components/chat`, `src/app/api/chat` |
| Ask (MCP) | MCP server (stdio + Streamable HTTP): exposure, stale items, deadlines, explain item, audit interest; drafts only | `src/mcp`, `docs/MCP.md` |
| Measure | 200-case eval (160 generated + 40 hand-written adversarial in `fixtures/eval`), stored per run | `pnpm eval`, `/eval` |

### Eval numbers

No accuracy figure is hardcoded in this repo's docs. `pnpm seed:demo` and `pnpm eval` score the classifier over
`fixtures/eval/cases.*.json` and store the run (`eval_runs`, `eval_results`, including the method that actually ran).
`/eval` shows the latest stored run with the method stated up front. With no `ANTHROPIC_API_KEY` the method is the
labeled deterministic heuristic, which is a baseline and not model accuracy. To get model numbers, set the key and run
`pnpm eval`.

## Public site and app

| Route | Access | What |
|---|---|---|
| `/`, `/how-it-works`, `/security` | Public | Marketing site. Static copy only: no database reads, no company data. Metadata uses `NEXT_PUBLIC_SITE_URL` |
| `/dashboard` and every other app page | Passcode | App home. Nav: Dashboard, Items, Approvals, Rules, Reports, Recoveries, Chat, Agent runs, Eval, Settings |
| `/login` | Public | Passcode login; lands on `/dashboard` |
| `/owner/[token]`, `/api/webhooks/*`, `/api/inngest`, `/api/mcp`, `/replica/*` | Token or signature | Owner links, signed webhooks, Inngest, MCP bearer token, replica portals |

The passcode gate (`src/proxy.ts`, `src/app/login/gate.ts`) allowlists exactly three marketing paths (`/`,
`/how-it-works`, `/security`), with no prefix matching. In production it fails closed with a 503 until `APP_PASSCODE`
is set. The UI is black with electric-blue and pink accents: blue marks what runs on its own, pink marks where a person
must act.

## Chat (`/chat`, generative UI)

Ask in plain language; the assistant calls tools and the interface renders each result as a card next to a short reply.
Requires `ANTHROPIC_API_KEY` (the route answers 503 "not configured" otherwise). It runs on `ORCHESTRATOR_MODEL`
(default Opus 5.5) at low effort, is session-guarded and rate-limited per session, and logs each turn as an `agent_runs` row.

- **Tools (17, `src/lib/chat/tools`).** Read: `get_exposure`, `list_stale_items`, `explain_item`, `upcoming_deadlines`,
  `get_audit_interest_exposure`, `list_pending_approvals`, `list_rules`, `list_reports`, `list_recoveries`,
  `list_agent_runs`, `get_agent_run`, `get_clock`. Prepare or simulate: `create_outreach_draft` (a draft awaiting approval),
  `generate_report` (writes a validated file, files nothing), `start_recovery_search` (browser agent on REPLICA portals),
  `advance_clock` (demo date only), `open_view` (navigation link).
- **Views (`src/lib/chat/ui-types.ts`).** `exposure`, `items`, `item_timeline`, `deadlines`, `interest`, `approvals`,
  `approval_card`, `rules`, `reports`, `report`, `recoveries`, `runs`, `agent_run`, `clock`, `link`, `error`. Payloads are
  plain JSON built by the server; the model never sees them and cannot author UI.
- **The model can never approve anything.** No tool approves, sends, mails, emails, calls, files, submits or pays. An
  approval card shows exactly what would be sent and links to `/approvals`, where the human click happens. The system
  prompt repeats this, but the guarantee is that the tool does not exist, and the approval itself is enforced
  server-side (`src/lib/approvals.ts`).
- Legal facts come only from tool results, with UNVERIFIED and UNKNOWN surfaced. Tool results are treated as data, not
  instructions.
- **Offline.** `ESCHEAT_OFFLINE=1` replays recorded model calls only (`ESCHEAT_RECORD=1` with a key records them).
  Chat cassettes for the demo prompts ship in `fixtures/cassettes/chat/` (re-record with `pnpm chat:record`, check with `pnpm chat:verify`); any other prompt reports "no recorded answer" rather than inventing one.

## Live services (test mode only)

Every key is optional. Without one, that feature shows an honest "not configured" state.

| Service | Variables | Where to get it | Notes |
|---|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | console.anthropic.com | Classifier, `/chat`, Stagehand agents, eval. Stagehand defaults to `anthropic/claude-sonnet-5-5` (`STAGEHAND_MODEL` overrides) |
| Lob (letters) | `LOB_TEST_API_KEY`, `LOB_WEBHOOK_SECRET` | dashboard.lob.com, Settings > API Keys, **test** key | Must start `test_`; live keys are refused. Letters are never mailed |
| AgentMail (email) | `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID`, `AGENTMAIL_WEBHOOK_SECRET`, `ALLOWED_TEST_RECIPIENTS` | agentmail.to | Run `pnpm agentmail:setup` to create/find the dedicated inbox and print the id. Webhook (Svix `whsec_...`) is optional |
| Vapi (voice) | `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VAPI_ASSISTANT_ID` (optional), `ALLOWED_TEST_PHONES` | dashboard.vapi.ai (private API key, imported phone number) | Calls only to allowlisted E.164 numbers; assistants with transfer tools are refused |
| QuickBooks Online | `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_TOKEN_SECRET` | developer.intuit.com, sandbox company | Sandbox only. Tokens are encrypted at rest (falls back to `OWNER_LINK_SECRET`) |
| Plaid | `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=sandbox` | dashboard.plaid.com | Sandbox only |
| Inngest | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | inngest.com | Not needed locally; dev mode is automatic outside production |
| Neon | `DATABASE_URL` | neon.tech | Unset = file-backed PGlite. Use Neon for any deployment |
| Browserbase | `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID` | browserbase.com | Optional hosted browser; default is local Playwright |

Other variables (all in `.env.example`, each with a comment): `APP_BASE_URL`, `NEXT_PUBLIC_SITE_URL`, `APP_PASSCODE`,
`SESSION_SECRET`, `SESSION_EPOCH`, `APPROVAL_TTL_HOURS`, `OWNER_LINK_SECRET`, `MCP_TOKEN`, `MCP_ALLOWED_HOSTS`,
`REPLICA_SESSION_SECRET`, `DEMO_ANCHOR_DATE`, `DEMO_MODE`, `STALE_THRESHOLD_DAYS`, `ESCHEAT_OFFLINE`, `ESCHEAT_RECORD`,
`AGENTS_ENABLED`, `AGENT_HEADED`, `PGLITE_DATA_DIR`, `NEXT_DIST_DIR`, `ORCHESTRATOR_MODEL`, `WORKER_MODEL`.

### AgentMail setup

Outreach email is sent from one dedicated AgentMail inbox, never from any other inbox in your account.

```bash
# put AGENTMAIL_API_KEY in .env.local, then:
pnpm agentmail:setup   # creates (idempotently, client_id) or finds the "escheat-agent" inbox and prints AGENTMAIL_INBOX_ID
```

Paste the printed `AGENTMAIL_INBOX_ID` into `.env.local`. Without it email is refused as "agentmail not configured";
the app itself never creates inboxes. Recipients stay limited to `ALLOWED_TEST_RECIPIENTS`. Delivery tracking is optional:
point a webhook at `/api/webhooks/agentmail` and set `AGENTMAIL_WEBHOOK_SECRET` (Svix `whsec_...`).

### Live check

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
| Stagehand | Runs the recovery agent in Stagehand mode against the local replica (needs `pnpm dev` running). Fails unless the run is in `stagehand` mode and made at least one model call, so a pass proves the model actually ran. SKIPPED if the replica is unreachable |
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

### Offline mode

`ESCHEAT_OFFLINE=1` replays recorded model calls from `fixtures/cassettes/` (record them once with a key and
`ESCHEAT_RECORD=1`). A missing cassette falls back to the labeled heuristic (chat reports unavailable instead). Lob,
AgentMail and Vapi become local fakes whose results say "Offline mode: nothing was sent"; they never claim mail,
email or a call went out.

## Running the demo

The full 3-minute spoken script, with exact clicks and fallbacks, is in [`docs/DEMO.md`](docs/DEMO.md). The flow:

1. **Marketing site.** Open `/` (no passcode needed), scroll "From a ledger export to a filed report, in six steps",
   glance at `/security`, then click **Open the demo** to enter `/dashboard`.
2. **Dashboard.** `pnpm seed:demo && pnpm dev`: **$61,915.00** across **47** stale items, CA 21 ($28,410) · TX 15
   ($19,862) · DE 11 ($13,643). "Stale" is a business threshold (180 days), not law.
3. **Item.** Open check **#10482** (Bayline Electric, $2,340.00): `/items?item=10482` shows the legal timeline, each
   date with its rule path, version and source links, and UNVERIFIED until you approve the rule at `/rules`.
4. **Chat.** Open `/chat` and ask "What do we owe and where?", then "Explain check #10482", then "Draft the
   due-diligence letter for #10482". The reply says the draft awaits approval and nothing was sent. Go to
   `/approvals`, review exactly what will be mailed, Approve, then Send (Lob TEST PDF when the key is set). Email and
   call drafts work the same way. The owner page records the owner's answer; marking it paid is an authenticated in-app step.
5. **Time travel and report.** Header **Demo date** → +1y: items move through `dd_pending` → `to_report`.
   `/reports` → Generate CA → validated NAUPA file + evidence pack.
6. **Filing agent.** Run filing agent: it logs into the REPLICA CA portal, uploads, checks totals, and **pauses at
   "Approve submission"**. Approve in the app → it submits and records the confirmation number.
7. **Recovery.** `/recoveries` → Run recovery search → finds **$1,180.00** held in TX for "NORTHWIND FIXTURES INC" →
   approve → file claim.
8. **MCP.** Ask Claude via MCP: "What do we owe in unclaimed property, and where?" (setup in `docs/MCP.md`).
9. **Eval.** `/eval` shows the stored eval run, with the classification method stated up front.

`pnpm agent:file CA` and `pnpm agent:recover` drive the same agents from the CLI.

### Demo reset

`pnpm seed:demo` resets everything to the demo starting state in one command (idempotent): migrate, wipe,
seed the SYNTHETIC company/ledger/clears/eval cases, sync rule files to the DB, run stale detection
(47 items / $61,915.00; CA 21, TX 15, DE 11), reset the demo clock to the anchor, run the eval once
(labeled heuristic when there is no `ANTHROPIC_API_KEY`), and clear outreach, approvals, reports,
recoveries, agent runs and replica tables. It prints a summary block and fails if the invariants break.
Stop the dev server first when using the default PGlite directory (PGlite is single-process), or set
`PGLITE_DATA_DIR` to a separate directory.

## Architecture

```text
 ledger (CSV / QBO / Plaid)
        |  ingest + reconcile (src/lib/ingest, recon)
        v
 Postgres (PGlite locally, Neon deployed; Drizzle, drizzle/)
        |
        +--> classifier (Haiku -> Opus -> review queue; owner state re-derived in code)
        +--> rules engine (rules/*.json -> dates, UNVERIFIED / UNKNOWN propagation)
        +--> timeline state machine (src/lib/timeline) --> Inngest functions (src/inngest)
        |
        v
 Next.js 16 app router
   (marketing)  /, /how-it-works, /security            public, static
   (app)        /dashboard /items /approvals /rules /reports /recoveries /chat /runs /eval /settings
   api          chat (NDJSON stream), mcp, ingest, outreach, reports, recoveries, agents, webhooks, inngest
   owner/[token], replica/*                            signed owner links, replica state portals
        |
        v
 approvals (src/lib/approvals.ts)  <-- the single human gate, content-hash bound, expires (APPROVAL_TTL_HOURS)
        |
        +--> Lob TEST letters, AgentMail email, Vapi calls   (allowlists, test keys)
        +--> NAUPA writer + validator + evidence pack  --> Stagehand / Playwright filing agent --> /replica/*
```

- **Gate.** `src/proxy.ts` applies the passcode gate and CSRF origin checks; routes and server actions re-check the
  session themselves. Tool-style surfaces (chat, MCP) can only prepare drafts.
- **LLM layer.** `src/lib/llm` wraps the Anthropic SDK with cassette record/replay, cost accounting and `agent_runs`
  logging. Model ids live in `config/models.ts`.
- **Browser agents.** Stagehand with a Sonnet 5.5 default when a key is set, otherwise a labeled scripted Playwright
  driver; fenced to the replica at the URL, network and DNS level.
- **Design notes** live in `docs/` (`API-NOTES.md`, `MCP.md`, `naupa-format.md`, `rules-research.md`,
  `UI-NOTES.md`, `SECURITY-REVIEW.md`).

### Database modes

- **PGlite (default).** With `DATABASE_URL` unset, `getDb()` uses a file-backed PGlite at `.data/pglite`
  (gitignored). Tests use an in-memory PGlite with migrations applied (`createTestDb()`).
- **Neon.** Set `DATABASE_URL` and the same code uses `drizzle-orm/neon-serverless`.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` / `build` / `start` | Next.js dev server, production build, production server |
| `pnpm seed:demo` | Reset to the synthetic demo state (migrate, wipe, seed, detect, eval once) |
| `pnpm db:generate` / `db:migrate` | Generate a migration after editing `src/db/schema.ts`; apply migrations |
| `pnpm gen:synthetic` | Regenerate the synthetic ledger fixtures |
| `pnpm eval` | Score the classifier over `fixtures/eval` and store the run |
| `pnpm pipeline:run` | Run the ingest / classify / date pipeline from the CLI |
| `pnpm agent:file CA` / `agent:recover` | Drive the filing and recovery agents from the CLI |
| `pnpm mcp:stdio` | MCP server over stdio (see `docs/MCP.md`) |
| `pnpm smoke:live` | Prove each live service with real keys (see "Live check") |
| `pnpm agentmail:setup` | Create or find the dedicated AgentMail inbox |
| `pnpm typecheck` / `lint` / `test` | tsc, ESLint, Vitest |
| `pnpm verify:fast` | typecheck + lint + test |
| `pnpm verify` | typecheck + lint + test + build + e2e |
| `pnpm e2e` / `e2e:offline` | Playwright; offline re-runs the demo path with `ESCHEAT_OFFLINE=1` |

### End-to-end tests

`pnpm e2e` starts three isolated dev servers (each re-seeds its own PGlite directory, see `scripts/e2e-server.ts`):
`demo` runs `tests/e2e/demo-path.spec.ts` (the full demo path in a real browser), `agents` the browser-agent API
contract, `ui` the replica/UI specs. The e2e servers scrub live keys (Anthropic, Lob, AgentMail, Vapi, QuickBooks,
Plaid, `DATABASE_URL`), so your `.env.local` is never used and "not configured" states are deterministic.
`E2E_PORT` sets the base port (default 3320), `E2E_DIR_SUFFIX` allows two runs at once, and `E2E_SHOTS_DIR=<dir>`
captures visual-QA screenshots at 375/1024/1440.

> pnpm 12 note: if a tool fails with `spawn ENOEXEC`, the `pnpm` shim has no shebang; put a one-line
> `#!/bin/sh` wrapper that execs it earlier on `PATH`.

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
  approves it at `/rules`. Some values are `null` with a TODO (e.g. the TX minimum reportable amount, which no
  source states); the engine shows UNKNOWN for anything that depends on them.
- **Replica portals only.** `/replica/*` imitate a holder-filing portal and an unclaimed-property search. They are
  not real state systems; the browser agents are fenced to them at the URL, network and DNS level.
- **Synthetic data only.** Northwind Fixtures, Inc. and every payee, address and amount are generated
  (`fixtures/SYNTHETIC.md`). The holder TIN is always `000000000`.
- **Eval numbers without a key are a heuristic baseline**, labeled as such on `/eval`; they are not model accuracy.
- **Chat offline replays only the recorded demo prompts.** Other questions need a live key; re-record after changing the system prompt, tools or seed data.
- **Browser agents need a local Chromium**, so on Vercel they are disabled unless `AGENTS_ENABLED=1` on a host
  that can run Playwright. PGlite is single-process; use Neon (`DATABASE_URL`) for any deployment.
- **Email is outbound only.** Delivery events from AgentMail are applied; inbound owner replies are not wired.
  AgentMail does not support cold outreach, so only allowlisted test recipients are emailed.
- **NAUPA format:** PROPADD, securities and tangible records are not generated; a few spec positions were inferred
  (`docs/naupa-format.md`). CA's notice report uses report type `A`, which is unconfirmed.
- Security review and remediation notes: `docs/SECURITY-REVIEW.md`.
