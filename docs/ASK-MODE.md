# ASK-MODE: two modes, Ask and Dashboard

Status: spec, not built. It sits on top of DESIGN-V4 ("Tidewell glass", branch `worktree-agent-ab3f1e53171103105`,
`docs/DESIGN-V4.md`) and assumes that work has merged first: `SectionNav.tsx`, `chrome.ts`, the `glass*` utilities, the
fixed backdrop, and the light cream `type-display` headline.

What the user asked for: "the dashboard is too cluttered and a little hard to understand ... two sections you can be
in. One chat agent that can do everything when asked ... it will generate UI to allow you to do it or do it for you.
And a dashboard section to view things ... keep some of the 3D animations too."

The hard rules are unchanged:

- The LLM never decides the law.
- Every irreversible step needs a human click on an existing server-enforced approval endpoint.
- Synthetic data only. Replica portals only. No real sends.
- Navy, cream and coral (steel for info), and no green.
- The disclaimer is on every screen.
- 3D is lazy-loaded, has a static fallback, and respects reduced motion.

---

## 1. The two modes

| | **Ask** (default landing) | **Dashboard** |
|---|---|---|
| Route | `/ask` | `/dashboard` and every existing `(app)` page |
| Purpose | Do things: ask a question, or ask it to do something | View things: the calm overview, plus every existing page as it is today |
| Chrome | Top bar with brand, mode switch, clock and ☰. No section pill nav and no Loop Bar. Footer disclaimer stays. | V4 shell unchanged: section pill nav, Loop Bar, footer |
| Body | One centered column (`max-w-[880px]`) on the glass backdrop | Pages as today |

### 1.1 Ask landing (empty state)

The empty state appears before the first message. From top to bottom:

1. **Headline.** `type-display`, weight 300, cream, two lines: "What do you want / to get done?". Below it is one
   `fg-2` sentence: "Ask a question, or ask me to do something. Anything that leaves the app waits for your click."
2. **Composer.** A large `glass-strong` pill, 56px high, centered. It reuses `Composer.tsx` with a new `size="hero"`
   prop. Autofocus is on at ≥ 1024px and off on touch.
3. **Starter chips.** Up to 6 `glass-pill` chips built from real state (§1.4). A chip that needs a person is coral; one that only reads is steel.
4. **Where the money is.** A 3D preview card (§4) on the right at ≥ 1024px, and under the chips below that.
5. **Footer.** The footer disclaimer, as on every page.

After the first message:

- The hero collapses. The column becomes the existing transcript (`Messages.tsx` / `TurnView`).
- The composer docks at the bottom (sticky, safe-area padded).
- This is the current `ChatApp` behaviour, given the Ask layout through a `variant="ask"` prop.
- All existing chat testids stay (`chat-empty`, `chat-example`, `chat-model`, `view-*`).

### 1.2 The switch

The switch is a segmented pill, `components/shell/ModeSwitch.tsx`.

- **Element.** `<nav aria-label="Mode">` holding two `next/link`s: **Ask** and **Dashboard**. The current one has
  `aria-current="page"`. These are links, not tabs: switching mode is navigation.
- **Testids.** `mode-switch`, `mode-ask` and `mode-dashboard`.
- **Look.** A `glass-pill` capsule. The active segment gets the same inner raised pill and dot as V4 `SectionNav`
  (DESIGN-V4 §5), so the bar reads as one system.
- **Size.** 32px high. Each hit area is at least 44×32px. On touch, `::after` grows it to 44×44.
- **Placement.** In the top bar, right after the brand, at every width.
  - In Dashboard mode at ≥ 1024px the V4 section pill nav follows it.
  - In Ask mode the section nav is not rendered (calm). The ☰ sheet still lists every page.
- **Badge.** At ≥ 375px the Dashboard segment carries the coral approvals count (from `SidebarData`) when it is above
  0, so nothing waiting on a person is hidden while you are in Ask.

### 1.3 URLs, shortcuts, deep links

- **Mode comes from the pathname only.** `modeOf(pathname)` (pure, `components/shell/mode.ts`) is `"ask"` for `/ask` and `/ask/*`, else
  `"dashboard"`. No cookie, no query flag, so every existing URL keeps its meaning.
- **Ask URLs.** `/ask` restores the conversation (`use-chat.ts` already persists it in `sessionStorage`). `/ask?q=…` sends, `/ask?ask=…`
  prefills: the existing `ChatApp` param semantics (`ChatApp.tsx` ~L176).
- **`/chat`** becomes a permanent redirect: `redirects()` in `next.config.ts`, `{ source: "/chat", destination: "/ask", permanent: true }`
  (the query carries over). Delete `src/app/(app)/chat/page.tsx`; keep `chat/actions.ts` (imported by `ClosePlanView.tsx`). Tour steps,
  `ReportsView.tsx`, `theater/page.tsx` and e2e `goto("/chat")` keep working.
- **Dashboard target.** The segment links to the last Dashboard-mode path from `sessionStorage["es-last-dashboard"]` (try/catch), fallback
  `/dashboard`. `ShellFrame` writes it on pathname change in dashboard mode; SSR links `/dashboard` and the client swaps after hydration.
- **Default landing.** `DEFAULT_NEXT_PATH` in `src/app/login/gate.ts` becomes `"/ask"`; an explicit `?next=` still wins; marketing `/` is unchanged.
- **Shortcuts** (`shortcuts.ts` registry + `useShortcuts.ts`): `mod+/` (id `mode-toggle`, group "Anywhere", shell) toggles mode, also while
  typing in the composer; no clash with `/` (page filter) or `?` (sheet); the switch carries `aria-keyshortcuts="Meta+/ Control+/"`.
  `GO_TARGETS` `g c` becomes `{ href: "/ask", label: "Ask" }`; `g d` stays Dashboard.
- **Navigation entries.** `nav-items.ts`: "Chat" becomes `{ href: "/ask", label: "Ask", match: ["/chat"] }` and leaves the V4 "Agents"
  section (Runs, Theater, Eval stay). `CommandPaletteDialog.tsx`: "Ask …" targets `/ask?q=`; add "Switch to Ask" and "Switch to Dashboard".

### 1.4 Starter chips from real state

The chips are built by a pure function, `src/lib/ask/starters.ts`: `askStarters(s: StarterState): AskStarter[]`.

- Its input is loaded server-side by `src/lib/ask/starter-data.ts`. That loader reuses:
  - `getLoopData`, for the counts and the next-action input;
  - `upcomingDeadlines`;
  - `listClosedPeriods` and `closePreviews`;
  - the integration booleans from §2.
- The order is fixed and the list is capped at 6.
- Hints are counts over real rows ("3 waiting"). A hint never carries a legal date or value.

| Condition | Chip prompt | Tone | Slice |
|---|---|---|---|
| ledger rows = 0 | "Upload a ledger CSV" | coral | 3 |
| overdue > 0 | "What's overdue?" | coral | 2 |
| approvals waiting > 0 | "What needs my approval?" | coral | 1 |
| draft-ready > 0 | slice 1: "Draft the due-diligence letter for #N" (first draftable check). From slice 3: "Set up outreach" | coral | 1 / 3 |
| prior month not closed | "Close October 2026" (month label from the demo clock) | coral | 4 |
| a state has To Report items | "Close out California for this cycle" (existing `CLOSE_OUT_PROMPTS`) | steel | 1 |
| always | "What do we owe and where?", "What's due in the next 90 days?" | steel | 1 |
| QBO and Plaid both not configured | "Set up integrations" | steel | 3 |

When chat is offline, chips pass through the same filter as `EmptyChat`:
`hasRecordedAnswer([], q) || answerableOffline(q)`. Offline Ask therefore never suggests something it cannot answer.

---

## 2. "Can do everything" as generative UI

**The mechanism already exists.** A chat tool returns `{ summary, data, ui }`. `data` goes to the model and `ui` goes
only to the client. `ViewRenderer` (`components/chat/views/registry.tsx`) maps `ui.kind` to a card.

Ask adds two kinds of capability:

- **(a) Safe tools** the agent calls directly. These are reads, drafts, validated files, and agent runs that file nothing.
- **(b) Action cards.** A tool returns a card, and the **person** completes the action on it. The card posts to the
  **existing** route, which re-checks the session, the typed approver name (`approverNameSchema`) and the content hash.

**Invariants.** Each one gets a test; see the slices.

1. `ChatToolContext` keeps having no approver identity. No tool approves, sends, files, submits, pays or closes.
   - Every new tool is `writes: false`.
   - `tools.test.ts` asserts that no tool name matches `/^(approve|send|file|submit|pay|close_period|adopt)_/`.
   - It also asserts that the only `writes: true` tools are the three that exist today: `create_outreach_draft`,
     `generate_report` and `start_recovery_search`.
2. Cards are client components. They POST only from a person's `onClick` or `onSubmit`. Never on mount or in
   `useEffect`. Each card has a vitest render test proving that mounting it makes no POST.
3. Hashes, ids and `companyId` come from the server, inside `ui` only. They are never in `data`, so the model never sees or echoes them.
   - The model's inputs are small: a state code, a check number, a period `YYYY-MM`, a rule path or an import kind.
   - Each input is zod-validated and existence-checked, as `open_view` does today.
4. Law comes from the engine. Dates, values, citations and UNVERIFIED flags are copied from the rules engine, the
   timeline and `adopt.ts`. The model never fills a legal value. A rule card proposes only the value read from the rule file's cited official source.
5. Uploaded CSV text and integration secrets never enter the model context.
   - CSV text goes from the card straight to `/api/ingest`.
   - Secrets are shown as booleans plus env var **names**, never values.

### 2.1 Intent map

Columns:

- **Path.** "tool" means the agent does it directly. "card" means the person completes it. "link" opens an existing page.
- **New?** "new" means a new tool and `ui.kind`. "—" means it exists today.

| Intent (example) | Path | Tool → `ui.kind` | New? | Existing code to reuse | New code | Safety notes |
|---|---|---|---|---|---|---|
| "What do we owe and where?" | tool | `get_exposure` → `exposure` | — | `ExposureView`, `ExposureRing` | — | read |
| "What's overdue?" | tool | `list_overdue` → `overdue` | new | `lib/overdue.ts` (`OverdueAssessment`, `isPastDue`), `components/overdue/*` | `views/OverdueView.tsx`; tool in `tools/insights.ts` | read. `date_unknown` is shown as UNKNOWN, never guessed |
| "What's due in 90 days?" / "Explain #10482" | tool | `upcoming_deadlines` / `explain_item` | — | `DeadlinesView`, `ItemTimelineView` | — | read |
| "Upload a ledger CSV" / "Import bank clears" | card | `start_import {kind}` → `import_card {companyId, kind}` | new | `settings/integrations/csv-card.tsx`, `lib/integrations/csv-upload.ts`, `POST /api/ingest` (`IngestRequestSchema`) | Extract `components/import/CsvImportFlow.tsx` from `CsvCard`, used by both Settings and the card | The file goes from the browser to `/api/ingest` (session plus CSRF in `proxy.ts`). The model sees only the result if the user asks a follow-up. Re-import dedupes |
| "Connect QuickBooks" / "Set up integrations" | card | `get_integrations` → `integrations_card` | new | `settings/integrations/snapshot.ts` (`loadSettingsData`), `IntegrationRow`, `qbo-card.tsx`, `plaid-card.tsx`; `/api/integrations/qbo/connect`, `/api/integrations/plaid/link-token`, `/exchange`, `/status` | Move the pure snapshot into `lib/settings/integration-snapshot.ts (db, companyId, env)`; `lib/integrations/env-names.ts` (QBO_CLIENT_ID/SECRET/REDIRECT_URI, PLAID_CLIENT_ID/SECRET/ENV, LOB_TEST_API_KEY, AGENTMAIL_API_KEY/INBOX_ID, ALLOWED_TEST_RECIPIENTS, VAPI_API_KEY/PHONE_NUMBER_ID/ASSISTANT_ID, ALLOWED_TEST_PHONES, ANTHROPIC_API_KEY, INNGEST_EVENT_KEY/SIGNING_KEY, BROWSERBASE_API_KEY/PROJECT_ID) | Each row says either "Not configured: set `X`, `Y` in `.env.local` and restart" or "Configured" / "Connected". Never a value, and never a key-entry field in chat. Connect is the person's click on the existing OAuth or Link route |
| "Set up outreach" / "Draft letters for everything due" | card | `plan_outreach` → `outreach_plan` | new | `lib/outreach/bulk.ts` (`planBulkDraftFromDb`, `summarizePlan`), `POST /api/outreach/bulk-draft`, channel booleans from the snapshot (Lob test key, AgentMail allowlist, Vapi) | `OutreachPlanView.tsx`: draftable count, skip reasons, channel readiness, and a "Draft N letters" button | The plan is a dry run. The click writes **drafts only**, which wait in `/approvals`. Nothing is sent |
| "Draft the letter for #10087" | tool | `create_outreach_draft` → `approval_card` | — | `ApprovalCardView` (POST `/api/outreach/[id]/approve` with `approvedBy` and `expectedContentSha256`) | — | Inline approve only when `fullyShown`. Approving does not send |
| "What needs my approval?" | tool | `list_pending_approvals` → `approvals` | — | `ApprovalsView` | Per row, a "Review here" ask chip that sends the matching prompt (e.g. "Approve the CA report") | read |
| "Send the approved letters" | link | `open_view {view:"approvals"}` → `link` | — | `approvals/SendAllApproved.tsx`, `/api/outreach/send-approved` | — | **Never in Ask.** Sending happens in Approvals, under the allowlist and the Lob test key |
| "Generate the CA report" | tool | `generate_report` → `report` | — | `ReportView` | — | validated file; files nothing |
| "Approve the CA report" | card | `prepare_report_approval {state}` → `report_approval` | new | `reports/ReportActions.tsx` approve flow, `b/ApproveAnywayBox.tsx`, `POST /api/reports/[id]/approve` (`expectedChecksum` plus acknowledged counts) | `ReportApprovalView.tsx` | The server re-derives the unverified and never-sent counts, and drift returns 409. The approval files nothing |
| "File the CA report" | card | `prepare_filing {state}` → `filing` | new | `reports/FilingPanel.tsx` (`POST /api/agents/file`), `/close-out/[state]` `CloseOutRunner`, `AgentRunView` (live run) | `FilingCardView.tsx`: shows the approval step first when the report is unapproved, then "Open the replica runner ↗" and "Start filing agent" | Replica portals only. `browser-agents/filing.ts` calls `assertApproved` before opening the portal (R8-03). The `AGENTS_ENABLED` gate applies |
| "Close out Texas" | tool | `plan_close_out` → `close_plan` | — | `ClosePlanView`, `runClosePlanStep` (drafts or a report only) | — | unchanged |
| "Record the CA payment" | link | `plan_close_out` remit step → `/close-out/CA` | — | `close-out/RecordRemittance.tsx`, `/api/close-out/remit` | — (deferred card) | Typed name bound to the count and the cents. Nothing is paid |
| "Close October" / "Close November" | card | `prepare_period_close {period?}` → `period_close` | new | `lib/close-pack/close.ts` (`closePreviews`, `listClosedPeriods`), `ledger/ClosePackButton.tsx`, `GET` and `POST /api/close-pack` | Extract `components/close/ClosePeriodConfirm.tsx` from `ClosePackButton` | **Irreversible.** Typed name plus `expectedJournalSha256`, consumed once. A month that is still open or already closed is stated plainly. A closed month offers the frozen pack download |
| "Which rules are unverified?" | tool | `list_rules` → `rules` | — | `RulesView` | — | UNVERIFIED badges stay |
| "Verify CA required language" | card | `review_rule {state, path}` → `rule_adoption` | new | `rules/adoption-review.tsx` (`AdoptionReview`; GET/POST `/api/rules/[state]/adopt`, `expectedVersion` and `expectedSha256`), `lib/rules/adopt.ts` | Card wrapper. `path` is validated against the rule file's field list | The value comes from the cited official source in the rule file. The model only names the field. A human types a name |
| "Find money owed back" | tool | `start_recovery_search` → `agent_run` | — | `AgentRunView` | — | replica only; files nothing |
| "Approve the DE claim" | card | `prepare_claim {recovery}` → `claim` | new | `recoveries/ClaimCard.tsx` (`/api/recoveries/[id]/approve` with `expectedPayloadSha256`, then `/api/agents/claim/[id]`) | Card wrapper | payload hash; replica only |
| "Move the clock to Dec 1" | tool | `advance_clock` → `clock` | — | `ClockView` (the person clicks; `/api/clock`) | — | only proposes |
| "Reset the demo" | link | `open_view {view:"settings"}` | view added | Settings reset dialog, `/api/demo/reset` | add `settings` to `VIEWS` in `tools/system.ts` | Never reset from chat |
| "CFO brief" | link | `open_view {view:"cfo_brief"}` → `/api/cfo-brief.pdf` | view added | `dashboard/cfo-brief-button.tsx` | `VIEWS` entry | read-only file |

### 2.2 Tool and prompt changes

**Registration.**

- The new tools are appended at the **end** of `CHAT_TOOLS` in `tools/index.ts`, all in one change, so the cached prefix changes only once.
- The ui types are added to `ui-types.ts` as one discriminated-union extension. That file is the frozen contract
  between the server slice and the card slices.

**System prompt.** Add to `system-prompt.ts`, under "What you can and cannot do":

> When the user asks to do something that needs their file, their click or their name (upload a CSV, connect an
> integration, set up outreach, approve, file, close a month, adopt a rule value), call the matching
> `start_`/`plan_`/`prepare_`/`review_` tool so the card appears, say in one sentence what the card lets them do, and
> never say it happened.

The prompt stays free of dates and ids.

**Follow-up chips.** `followups.ts` gets a case for each new kind:

- after `import_card`: "What do we owe and where?";
- after `overdue`: "Generate the CA report" for the first late state;
- after `outreach_plan`: "What needs my approval?".

The chips still never point at approving or sending.

---

## 3. Offline and demo behaviour

### 3.1 Availability

- **Today.** `chatAvailability()` in `lib/chat/agent.ts` returns one of three states:
  - `ready` when a key is set;
  - `offline` when `ESCHEAT_OFFLINE=1`, which means cassette replay plus direct answers;
  - `not_configured` when there is no key, which disables the composer and makes the route return 503.
- **Ask change (slice 2).** With no key, Ask takes the existing offline path instead of a dead composer:
  `chatAvailability()` returns `offline` when `ANTHROPIC_API_KEY` is empty.
  - The banner stays honest: "Model not configured (ANTHROPIC_API_KEY is not set). Answers replay recordings or
    come straight from your data; nothing is made up."
  - It keeps `data-testid="chat-not-configured"`, and `chat-model` shows "offline replay".
  - The route stops returning 503. It runs `runChatTurn` in offline mode.
  - `tests/e2e/chat.spec.ts` ("refuses honestly without a key") is rewritten to assert the honest banner and a direct offline answer.

### 3.2 Direct (no-model) answers for new intents

- `offline-intent.ts` gains these ids, in specificity order:
  - `import` (upload / import plus CSV, ledger or clears);
  - `integrations` (connect, set up, integration, QuickBooks, Plaid);
  - `outreach_setup` (set up outreach / draft letters for all);
  - `overdue` (`\boverdue\b|\blate\b`);
  - `report_approval` (approve plus report plus a state);
  - `filing` (file / submit plus report plus a state);
  - `period_close` (`\bclose\s+(?:the\s+)?(month|<MonthName>)`, tried **after** `close_out`).
- Each maps to its tool with inputs the user typed: a state code, a month mapped to `YYYY-MM` against the demo clock
  inside the tool (never in the regex), or a kind.
- `offline-answer.ts` gets a template per new tool. The templates only copy tool output.
- `review_rule` and `prepare_claim` need an exact field or recovery. Offline they fall back to `list_rules` and `list_recoveries`.

### 3.3 Cassettes

- The cassette key (`replay-key.ts`, `chatCassetteRequest`) includes `system` and `tools` verbatim. Adding tools or
  changing the prompt therefore **invalidates every recording** in `fixtures/cassettes/chat` (37 files today).
- Slice 2 freezes the full tool list and the prompt, then re-records every group once with `pnpm chat:record`. That
  needs a key, so the orchestrator supplies one or records it.
- Until that re-record exists, slice 2 must not merge. Direct answers cover demos in the meantime.
- New groups in `recorded-prompts.ts`:
  - `ask` (read-only singles, fresh seed): "What's overdue?", "Upload a ledger CSV", "Set up integrations", "Set up outreach", "Close October 2026";
  - `filing` (a conversation that writes on turn 1): "Generate the CA report", "Approve the CA report", "File the CA report".

### 3.4 What `chat:verify` must cover

1. Every group replays `ok`, including `ask` and `filing`.
2. The `changed` scenario (data altered after recording) answers each new direct intent from data, with the `chat-offline-answer` label.
3. The no-key path: `ANTHROPIC_API_KEY=` without `ESCHEAT_OFFLINE` replays like `--verify`.
4. "weather in Paris" stays the one intended FAIL.

Update the script's summary count, and the "12 ok" line in the agent brief, to the new total.

Vitest guards:

- `recorded-prompts.test.ts`: every Ask starter that slice 1 shows on a fresh seed is recorded or answerable offline.
- `offline-intent.test.ts`: "Close October 2026" is `period_close` and "Close out California" is `close_out`.
- `tools.test.ts`: the invariants listed at the top of §2.

---

## 4. Keeping 3D in Ask

| Where | Visual | Reuse | Static fallback | Reduced motion |
|---|---|---|---|---|
| Ask empty state, preview card (right column at ≥ 1024, under the chips below that) | "Where the money is": the Money Map in a compact tilt (CSS 3D via `Stage3D`, pointer parallax ±4° at tier `full`) | `viz/money-map/MoneyMap.tsx` with a new `compact` prop (no legend, about 360×220). Data is `loadDashboard().mapStates`, `hqState` and `recovered`, from the cached `dashboard/data.ts` | Tier `static` renders the flat SVG with no tilt. `SrTable` rows stay for screen readers | `useRenderTier` returns `static` under `prefers-reduced-motion`, save-data or `es-motion=reduce`. No parallax, no thread animation |
| Ask headline backdrop (≥ 1024 only, decorative) | The vault scene as a soft ornament behind the headline at 40% opacity | `viz/core/LazyCanvas.tsx` with `VAULT_POSTER` (`/marketing/vault-poster.avif`) and `import("@/components/viz/vault-scene/VaultScene")`, as `marketing/HeroVault.tsx` does | The AVIF poster paints first and the canvas loads only when idle, in view, and at tier `full` or `lite`. The FPS probe drops it to the poster | Poster only. The canvas is unmounted, and its renderer disposed, when the first message is sent |
| Answers | Existing card motion (`ExposureRing`, `ClosePlanView` NumberFlow) | unchanged | — | `MotionConfig reducedMotion="user"` (already in `ChatApp`) |

More rules:

- Clicking a state on the preview calls `onPick("Show the open CA items")`, which runs `list_stale_items`.
- The preview has no hidden numbers. Its label shows the same total as `get_exposure`.
- No new dependencies are added, and nothing 3D loads below 1024 except the CSS-tilt map.
- The ornament is `aria-hidden` and sits under the text, so it never lowers headline contrast. Check this with axe on the 1440 screenshot.

---

## 5. Implementation slices

Two agents can do this: **A** owns the shell and the server, **B** owns the cards.

- Run slices in order, except that slice 3 may start once slice 2's `ui-types.ts` commit lands.
- Every slice ends with `pnpm exec tsc --noEmit -p . && pnpm lint && pnpm exec vitest run --maxWorkers=2`.
- Every slice ends with its one Playwright spec under the global e2e lock, `--project ui`. Each spec runs axe via
  `new AxeBuilder({ page }).setLegacyMode(true)`, checks for no horizontal overflow at 375, 1024 and 1440, and checks that the disclaimer is visible.
- Re-run the existing specs that grep the copy or testids you changed: `chat.spec.ts`, `ui-r4-chat.spec.ts`,
  `ui-nav-speed.spec.ts`, `ui-v3-dashboard.spec.ts`, `a11y-keyboard.spec.ts`.
- Save screenshots to `.data/shots/ask-<slice>/` at 375 and 1440.

### Slice 1: mode switch and Ask landing, existing tools only (agent A)

Files:

- New: `src/components/shell/{mode.ts,mode.test.ts,ModeSwitch.tsx,HideInAsk.tsx}`; `src/app/(app)/ask/{page.tsx,loading.tsx}` (page:
  `connection()`, `chatAvailability()`, starters, money-map data, one `Suspense` with `NavHold`); `src/lib/ask/{starters.ts,starters.test.ts,
  starter-data.ts}`; `src/components/chat/AskHero.tsx`.
- Edited: `src/components/chat/{ChatApp.tsx (variant, starters, mapPreview; empty state renders AskHero),Composer.tsx (size="hero"),chat.css}`;
  `src/components/viz/money-map/MoneyMap.tsx` (`compact`); `src/app/(app)/layout.tsx` (`HideInAsk` around `<LoopBar/>` and the section nav);
  the V4 top bar `HeaderData.tsx` / `ShellFrame.tsx` (mount `ModeSwitch`, write `es-last-dashboard`);
  `src/components/shell/{shortcuts.ts,useShortcuts.ts,nav-items.ts,CommandPaletteDialog.tsx}`; `next.config.ts`; `src/app/login/{gate.ts,gate.test.ts}`.
- Deleted: `src/app/(app)/chat/page.tsx`. Update if they break: `src/components/tour/steps.ts`, `src/components/shell/hydration-location.test.ts`.

Unit tests:

- `modeOf` for `/ask`, `/ask/x`, `/askew` (which is dashboard), `/dashboard` and `/items?x`.
- The last-dashboard fallback when storage throws.
- `askStarters`: ordering, the cap of 6, coral vs steel, no chip when its count is 0, and a "What do we owe and where?" fallback on an empty state.
- The shortcut registry: `mode-toggle` exists, and `g c` points to `/ask`.

E2E, `tests/e2e/ui-ask-mode.spec.ts`:

- Login lands on `/ask`, and the headline and starters are visible.
- Clicking `mode-dashboard` goes to `/dashboard`. Visiting `/items`, then pressing `mod+/` twice, returns to `/items`.
- `/chat?q=What%20do%20we%20owe%20and%20where%3F` redirects to `/ask` and sends.
- In Ask the Loop Bar and section nav are absent, and the ☰ sheet lists every page.
- The money-map preview has its poster or flat fallback under `reducedMotion: "reduce"`.
- Axe passes, with no overflow at 375, 1024 and 1440.

Acceptance criteria:

- Every existing route renders unchanged in Dashboard mode.
- No existing testid is renamed.
- Ask chips offline are only recorded or direct-answerable prompts.
- The approvals count is visible on the Dashboard segment while in Ask.

### Slice 2: server side of every new capability, plus one re-record (agent A)

Files:

- `src/lib/chat/ui-types.ts` first, **committed alone** (the contract for slices 3 and 4): kinds `overdue`, `import_card`, `integrations_card`,
  `outreach_plan`, `report_approval`, `filing`, `period_close`, `rule_adoption`, `claim`.
- Tools: `tools/insights.ts` (`list_overdue`); `tools/workflow.ts` (`prepare_report_approval`, `prepare_filing`, `prepare_claim`, `review_rule`);
  new `tools/setup.ts` (`start_import`, `get_integrations`, `plan_outreach`); new `tools/close.ts` (`prepare_period_close`); `tools/system.ts`
  (`VIEWS`: `settings`, `cfo_brief`); `tools/index.ts` appends, in order: `list_overdue`, `start_import`, `get_integrations`, `plan_outreach`,
  `prepare_report_approval`, `prepare_filing`, `prepare_period_close`, `review_rule`, `prepare_claim`.
- New `src/lib/settings/integration-snapshot.ts` (then called by `settings/integrations/snapshot.ts`) and `src/lib/integrations/env-names.ts`.
- `src/lib/chat/{system-prompt.ts,offline-intent.ts,offline-answer.ts,recorded-prompts.ts,agent.ts (no key → offline)}`;
  `src/app/api/chat/route.ts` (no 503 for a missing key); `scripts/record-chat-cassettes.ts` (count, no-key verify); `fixtures/cassettes/chat/*`
  (full re-record).
- Not touched: `components/chat/views/**`. Until slice 3 the `ViewRenderer` default branch renders nothing for the new kinds.

Unit tests:

- Extend `tools.test.ts` with the §2 invariants. Add input validation for each new tool: unknown state, a period
  that is not `YYYY-MM`, and a rule path missing from the rule file, each giving a `ChatToolError`.
- Each new tool's `data` has no `contentSha256`, `checksum`, `payloadSha256`, `journalSha256` or `companyId` keys.
- Extend `offline-intent.test.ts` and `offline-answer.test.ts`.
- `scoping.test.ts`: the new tools only see the caller's company.

E2E, `tests/e2e/ui-ask-offline.spec.ts`. The e2e server has no key, so this path is the default:

- "What's overdue?" shows the direct-answer label and the `chat-not-configured` banner copy.
- "weather in Paris" says there is no recorded answer and invents nothing.

Acceptance criteria:

- `pnpm chat:verify` prints all groups `ok`, plus the single intended FAIL.
- No cassette is hand-edited.
- `tsc`, lint and vitest are green.

### Slice 3: low-risk action cards (agent B, after the slice 2 `ui-types.ts` commit)

Files:

- New, under `src/components/chat/views/`: `OverdueView.tsx`, `ImportCardView.tsx`, `IntegrationsCardView.tsx` and `OutreachPlanView.tsx`.
- New: `src/components/import/CsvImportFlow.tsx`, extracted from `settings/integrations/csv-card.tsx`. `CsvCard` then wraps it.
- Edited: `views/registry.tsx` (4 cases), `components/chat/followups.ts`, and `src/lib/ask/starters.ts` (the
  "Upload a ledger CSV", "Set up outreach" and "Set up integrations" chips).

Unit tests:

- Each card mounts with no POST (spy on `postJson` and `fetch`).
- `IntegrationsCardView` renders env var names and "Not configured", and never a value. Feed it a snapshot that
  contains a fake value and assert the value is absent.
- `CsvImportFlow` mapping, through the existing `csv-upload.test.ts` helpers.

E2E, `tests/e2e/ui-ask-cards.spec.ts`:

- Ask "Upload a ledger CSV" → drop `fixtures/synthetic/ledger.csv` with `setInputFiles` → map the columns → import → the result headline appears.
- "Set up integrations" → QBO and Plaid rows read "Not configured" with `QBO_CLIENT_ID` and similar names.
- "Set up outreach" → the plan shows counts. "Draft N letters" creates drafts, and the Approvals count rises with nothing sent.
- Axe and overflow checks as above.

Acceptance criteria:

- Settings → Integrations still imports a CSV exactly as before. Its existing specs stay green.

### Slice 4: approval-class cards (agent B)

Files:

- New, under `src/components/chat/views/`: `ReportApprovalView.tsx`, `FilingCardView.tsx`, `PeriodCloseView.tsx`,
  `RuleAdoptionView.tsx` and `ClaimView.tsx`.
- New: `src/components/close/ClosePeriodConfirm.tsx`, extracted from `ledger/ClosePackButton.tsx`, which then uses it.
- Edited: `views/registry.tsx`, `views/ApprovalsView.tsx` (the "Review here" chips), and `src/lib/ask/starters.ts` (the "Close <Month>" chip).
- Imported as they are, not changed: `reports/ReportActions.tsx`, `reports/FilingPanel.tsx`,
  `rules/adoption-review.tsx` and `recoveries/ClaimCard.tsx`. If a component is not importable as is, extract its
  inner part into `components/*` and keep the page file a thin wrapper.

Unit tests:

- Mount makes no POST.
- The approve button is disabled until `isValidApproverName`.
- The POST body carries the server-provided hash verbatim.
- On a 409 the card shows the server's problem and stays unapproved.
- `FilingCardView` shows the approval step when the report is not approved.

E2E, `tests/e2e/ui-ask-approvals.spec.ts`:

- "Generate the CA report" → "Approve the CA report". With no name the button stays disabled. With a name it reaches
  "Approved by a person" (steel) and nothing is filed.
- "Close October 2026" → typed name → closed, then the same month shows the frozen-pack download.
- A network listener asserts that no approval endpoint was called before the click.
- Axe and overflow checks as above.

Acceptance criteria:

- Every irreversible step in Ask goes through the same endpoint and hash as its page.
- `/approvals`, `/reports`, `/ledger` and `/recoveries` specs stay green.

### Slice 5: calm Dashboard and Ask polish (agent A)

Files:

- Edited: `src/app/(app)/dashboard/page.tsx` and `sections.tsx`.
  - The overview keeps the V4 stage, the deadlines and the money map.
  - The Sankey, audit interest and featured lifecycle move under one "More detail" disclosure (`<details>`, closed by default).
  - Action CTAs on the overview become "Do it in Ask ↗" links (`/ask?q=…`). The CFO brief download stays.
- Edited: `src/components/chat/AskHero.tsx`, to add the vault ornament (§4).
- Edited if they break: `tests/e2e/ui-v3-dashboard.spec.ts` and `ui-overdue.spec.ts`.

Unit tests: the Ask-link builder, `askHref(prompt)`, which encodes the prompt and caps it at `CHAT_LIMITS.maxUserChars`.

E2E, `tests/e2e/ui-ask-calm.spec.ts`:

- The dashboard first viewport shows the stage, and below it at most three sections until "More detail" opens.
- "Do it in Ask" lands in Ask with that prompt sent.
- Under reduced motion the vault ornament is the poster with no `<canvas>`. Under `full` the canvas mounts after idle.
- Axe and overflow checks as above.

Acceptance criteria:

- The overview has no action that bypasses Ask or a page.
- Every number on it is unchanged from today's data.
- LCP is no worse than today's `/dashboard`, measured with `pnpm` perf (`ui-v3-perf.spec.ts`).

---

## 6. Out of scope

- Approving, sending, filing, paying, resetting or closing from model text.
- Key entry in the UI.
- Payee merges in Ask (Ask links to `/payees`).
- Bulk approve in Ask (that stays in `/approvals`, `BulkApprove.tsx`).
- Voice input.
- New 3D scenes or dependencies.

Prototype. Not legal advice. Confirm filings with a qualified professional.
