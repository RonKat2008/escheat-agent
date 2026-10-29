# Escheat Agent

Prototype (BBS x Ramp hackathon). Automates unclaimed-property (escheatment) compliance for CA, DE and TX:
find stale checks and credits, compute legal timelines from sourced rule files, run owner outreach,
generate and file state reports against replica portals, and search for money owed back.

**Prototype. Not legal advice. Confirm filings with a qualified professional.**

## Setup

```bash
pnpm install
cp .env.example .env.local   # every variable is optional
pnpm db:migrate              # applies drizzle/ migrations (PGlite by default)
pnpm dev                     # http://localhost:3000
npx inngest-cli@latest dev   # Inngest dev server, auto-discovers /api/inngest
```

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
`agents` the browser-agent API contract, `ui` the replica/UI specs. Provider keys are scrubbed, so Lob/Resend
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
