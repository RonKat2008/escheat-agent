# Escheat Agent: API / SDK notes

Researched 2026-10-29 against npm registry, installed package typings, and official docs. Items marked VERIFIED were run or type-checked locally (scratch install). Items marked UNVERIFIED came from docs or secondary sources only. No live API keys were available, so no vendor calls were made.

## ⚠️ Differences from brief

1. **Anthropic forced tool_choice is rejected on claude-opus-5-5.** `tool_choice: {type:"any"|"tool"}` returns HTTP 400 on Opus 5.5 (also Sonnet 5.5, Fable 5.1). Thinking cannot be disabled on Opus 5.5 (`thinking:{type:"disabled"}` is a 400), and default effort is `medium`. Use `tool_choice:{type:"auto"}` plus `strict:true` tools, or (better) structured outputs via `output_config.format` for JSON results.
2. **Structured outputs are native.** Use `output_config: { format }` with `zodOutputFormat()` from `@anthropic-ai/sdk/helpers/zod` and `client.messages.parse()`. The old `output_format` param is deprecated (400 without a beta header). Structured outputs are documented as 400 with *document* citations enabled. Web search always returns citations; docs do not state whether `output_config.format` + web_search works in one call (UNVERIFIED, likely conflict). Plan on two calls: (a) research call with web_search, free text + citations, (b) structuring call with `output_config.format`, passing the cited URLs/quotes as text.
3. **Web search tool version.** Newest is `web_search_20260318`. `web_search_20260209` and `web_search_20250305` also exist. 20260209 and later default to dynamic filtering through code execution (`allowed_callers` defaults to `["code_execution_20260120"]`); set `allowed_callers:["direct"]` for plain, predictable search. Web search must be enabled for the org in Console. $10 per 1,000 searches plus tokens.
4. **Model ids are valid:** `claude-opus-5-5` ($4/$20 per MTok in/out, 1M ctx) and `claude-haiku-5-5` ($0.10/$0.50 up to 100K prompt). No date suffix. Haiku 5.5: adaptive thinking on by default, default effort `medium`; non-default `temperature`/`top_p`/`top_k` are 400s on both models (omit them).
5. **Anthropic SDK is 1.3.0 (1.x major).** Inngest is **v4** (4.26.1), not v3. @inngest/test is 1.0.0 and requires inngest ^4. See Inngest section for breaking changes.
6. **Inngest `@inngest/test` cannot mock `step.waitForEvent`** (VERIFIED broken with @inngest/test 1.0.0 + inngest 4.26.1; every mock, including `null`, throws `EventValidationError: Event not found in triggers: undefined`). `step.run` and `step.sleepUntil`/`sleep` mocks work. Workarounds below.
7. **Stagehand latest (4.3.0) is a rewrite.** No `new Stagehand({env:'LOCAL'})`, no `init()`. Local mode = `localBrowser.launch()` and it drives Chrome over CDP (no Playwright dependency; needs Chrome installed). The v3 line (`3.7.3`, dist-tag `v3-latest`) keeps `env:'LOCAL'` and matches the brief. **Recommendation: pin `@browserbasehq/stagehand@3.7.3`.** Neither version exposes `context.route()`. Network fencing must come from Playwright owning the browser and Stagehand attaching over CDP (VERIFIED recipe below). Playwright is NOT required by Stagehand itself (optional peer), but our approved `playwright` dep supplies Chromium plus the fence plus video.
8. **Stagehand v3.7.3 does not know claude-opus-5-5 / haiku-5-5** (its Anthropic helper lists opus-4-x and fable-5 only; its tool-forcing logic only special-cases fable-5). Passing `anthropic/claude-opus-5-5` may trigger forced tool_choice 400s (UNVERIFIED, no key). Use `anthropic/claude-sonnet-4-6` or `anthropic/claude-haiku-4-5` for Stagehand (both are in its known list), and keep a smoke test.
9. **MCP SDK: two lines.** `@modelcontextprotocol/sdk` 1.32.2 (v1, the "latest" dist-tag) vs new v2 packages (`@modelcontextprotocol/server` 2.4.0). `mcp-handler` 2.3.0 requires v2; `mcp-handler` 1.1.0 works with v1. Recommended: stay on `@modelcontextprotocol/sdk@1.32.2` and use its built-in `WebStandardStreamableHTTPServerTransport` (VERIFIED, works in a fetch Request/Response handler, no extra dependency).
10. **Resend sandbox restriction CONFIRMED.** `onboarding@resend.dev` can only deliver to the Resend account owner's own email (403 otherwise). Resend's setup guide: "Until the domain is verified, send from onboarding@resend.dev to the user's own address or to the test addresses." Arbitrary recipients need a verified domain. Test addresses `delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev`, `suppressed@resend.dev` (labels like `delivered+x@resend.dev` ok) work without a domain. Plan: ALLOWED_TEST_RECIPIENTS must be {account owner email, the *@resend.dev test addresses} unless a domain is verified.
11. **Lob test mode has no tracking events.** Tracking event types cannot be subscribed to in the Test Environment, and `tracking_events` is not populated for test mail. Only simulation is the dashboard "Debugger" (sends a fabricated event body to your URL; sign it using the literal secret string `secret`). Our "mailed/in transit/delivered" demo states must be produced by our own simulated-event endpoint, clearly labeled SIMULATED.
12. **Plaid sandbox: `check_number` exists on the Transaction type (`string | null`, "only populated for check transactions") but the custom sandbox user schema only accepts `date_transacted, date_posted, amount, description, currency`.** So sandbox transactions cannot carry a check number (expect null). Match checks to bank activity by amount/date/description, or treat check_number as best-effort (UNVERIFIED for non-custom sandbox users; test).
13. **QBO: there is no "cleared" or reconciled flag on Purchase.** `PrintStatus` is `NotSet | NeedToPrint | PrintComplete` (printing state, not clearing). Staleness must come from TxnDate (+ Plaid/bank data or our own uncleared flag). Intuit's developer docs are JS-rendered and could not be fetched, so field names were taken from Intuit's official Java SDK (see QBO section).
14. **Vapi outbound call needs a phone number in Vapi** (`phoneNumberId`); see section 7. No SDK is used.
15. **Drizzle:** npm `latest` is `drizzle-orm@0.45.4` / `drizzle-kit@0.31.11` (1.0 is only on the `rc`/`beta` tags; the docs site now shows `@rc` install lines). Use 0.45.4 and drizzle-kit 0.31.11. Note drizzle-kit needs `--config=drizzle.config.ts` when the config file is not the default name.

## Package versions (npm, 2026-10-29)

| Purpose | Package | Version |
|---|---|---|
| Claude | `@anthropic-ai/sdk` | 1.3.0 |
| Jobs | `inngest` | 4.26.1 |
| Jobs tests | `@inngest/test` | 1.0.0 (peer inngest ^4) |
| Dev server | `inngest-cli` (npx) | 1.49.0 |
| Browser agent | `@browserbasehq/stagehand` | 4.3.0 latest; **3.7.3 recommended** (`v3-latest`) |
| Browser | `playwright` | 1.64.1 |
| MCP | `@modelcontextprotocol/sdk` | 1.32.2 (v2: `@modelcontextprotocol/server` 2.4.0; `mcp-handler` 2.3.0 needs v2, 1.1.0 for v1) |
| Letters | `@lob/lob-typescript-sdk` | 1.4.2 (legacy `lob` 8.1.1 exists; TS SDK is the current one) |
| Email | `resend` | 6.35.0 |
| Webhook verify | `svix` | 2.9.1 (optional; resend SDK has `webhooks.verify`) |
| Voice | Vapi REST (plain `fetch`) | n/a |
| QBO OAuth | `intuit-oauth` | 4.2.5 (`node-quickbooks` 2.0.50 is an optional API wrapper) |
| Bank | `plaid` | 49.0.0 |
| ORM | `drizzle-orm` / `drizzle-kit` | 0.45.4 / 0.31.11 |
| Local DB | `@electric-sql/pglite` | 0.5.13 |
| Neon driver | `@neondatabase/serverless` | 1.2.0 |
| Validation | `zod` | 4.6.7 (Stagehand 4.x asks for ~4.4.3; 3.7.3 accepts ^3.25 or ^4.2) |

---

## 1. Anthropic SDK (`@anthropic-ai/sdk` 1.3.0)

Docs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs , https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool , https://platform.claude.com/docs/en/build-with-claude/prompt-caching

```ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const ORCHESTRATOR_MODEL = "claude-opus-5-5";
export const WORKER_MODEL = "claude-haiku-5-5";
const client = new Anthropic(); // reads ANTHROPIC_API_KEY

// A. Structured output (preferred for classification / reply parsing / report checks)
const Classification = z.object({
  propertyType: z.enum(["vendor_check", "payroll_check", "customer_credit", "unapplied_cash", "unknown"]),
  confidence: z.number(),            // minimum/maximum NOT supported in schema; the SDK strips them and re-validates client side
  reasoning: z.string(),
});
const res = await client.messages.parse({
  model: WORKER_MODEL,
  max_tokens: 1024,
  output_config: { effort: "low", format: zodOutputFormat(Classification) },
  messages: [{ role: "user", content: "Classify: ..." }],
});
if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") { /* handle */ }
const parsed = res.parsed_output; // typed, validated against the Zod schema (null if not parseable)

// B. Tool use loop (our code orchestrates). Use tool_choice auto on Opus 5.5.
const tools: Anthropic.Tool[] = [{
  name: "lookup_rule",
  description: "Get the verified rule file entry for a state",
  strict: true,
  input_schema: { type: "object", properties: { state: { type: "string", enum: ["CA", "DE", "TX"] } }, required: ["state"], additionalProperties: false },
}];
const msgs: Anthropic.MessageParam[] = [{ role: "user", content: "..." }];
for (;;) {
  const r = await client.messages.create({
    model: ORCHESTRATOR_MODEL, max_tokens: 16000, tools,
    tool_choice: { type: "auto" },     // NOT any/tool on opus-5-5 (400)
    output_config: { effort: "medium" },
    messages: msgs,
  });
  msgs.push({ role: "assistant", content: r.content });   // append content as-is
  if (r.stop_reason !== "tool_use") break;
  const results: Anthropic.ToolResultBlockParam[] = [];
  for (const b of r.content) if (b.type === "tool_use") {
    results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(await runTool(b.name, b.input)) /* is_error:true on failure */ });
  }
  msgs.push({ role: "user", content: results });          // ALL results in ONE user message
}
```

Server-side web search with citations (rule research):

```ts
let messages: Anthropic.MessageParam[] = [{ role: "user", content: "Find the dormancy period for ... cite official statute pages." }];
let r: Anthropic.Message;
do {
  r = await client.messages.create({
    model: ORCHESTRATOR_MODEL, max_tokens: 16000,
    tools: [{
      type: "web_search_20260318", name: "web_search",
      max_uses: 5,
      allowed_domains: ["leginfo.legislature.ca.gov", "law.justia.com", "sco.ca.gov"], // OR blocked_domains, never both (400)
      allowed_callers: ["direct"],     // skip dynamic filtering / code execution
    }],
    messages,
  });
  if (r.stop_reason === "pause_turn") messages = [...messages, { role: "assistant", content: r.content }]; // resend unchanged to continue
} while (r.stop_reason === "pause_turn");

for (const b of r.content) {
  if (b.type === "web_search_tool_result") {
    if (!Array.isArray(b.content)) console.warn(b.content.error_code);  // errors arrive as HTTP 200 with an object; e.g. max_uses_exceeded
    else for (const hit of b.content) console.log(hit.url, hit.title, hit.page_age);
  } else if (b.type === "text") {
    for (const c of b.citations ?? []) if (c.type === "web_search_result_location") console.log(c.url, c.title, c.cited_text /* <=150 chars */);
  }
}
```

Response blocks: `text` (decision), `server_tool_use` (`name:"web_search"`, `input.query`), `web_search_tool_result` (`content[]` of `web_search_result` with `url,title,page_age,encrypted_content`), then `text` blocks carrying `citations[]` of `{type:"web_search_result_location", url, title, cited_text, encrypted_index}`. `usage.server_tool_use.web_search_requests` counts searches.

Prompt caching: top-level `cache_control: { type: "ephemeral" }` on `messages.create` caches the last cacheable block (or put it on a system/tool block; `ttl:"1h"` optional). Order is tools, system, messages; any byte change before the breakpoint invalidates. Check `usage.cache_read_input_tokens`. Min cacheable prefix is model dependent (512 to 4096 tokens). Changing `output_config.format` invalidates the cache for that conversation.

Gotchas:
- Structured output schema limits: no recursive schemas, no `minimum/maximum/minLength/maxLength`, `additionalProperties:false` required (Zod object does this), `minItems` only 0 or 1, optional-param budget (24 across strict schemas), unions 16. First use compiles a grammar (extra latency).
- Always branch on `stop_reason` (`refusal`, `max_tokens`, `pause_turn`, `tool_use`). Server-tool errors do not throw.
- Opus 5.5: thinking is always on (adaptive). Control cost with `output_config.effort` (`low|medium|high|xhigh|max`, default `medium`). Thinking text is omitted by default (`thinking.display:"summarized"` to see it).
- Opus 5.5 and later can return a `refusal` stop reason from safety classifiers; the docs recommend a `fallbacks` option (beta header `server-side-fallback-2026-07-01`, `fallbacks:"default"` on `client.beta.messages.create`). Optional for this project; handle `refusal` gracefully at minimum.
- Pass web-search assistant blocks back unmodified in multi-turn (encrypted_content must be intact).
- Keep `temperature` etc. unset.

---

## 2. Inngest (`inngest` 4.26.1, `@inngest/test` 1.0.0)

Docs: https://www.inngest.com/docs/reference/typescript/migrations/v3-to-v4 , https://www.inngest.com/docs/reference/typescript/functions/create , https://www.inngest.com/docs/reference/typescript/functions/step-wait-for-event , https://www.inngest.com/docs/learn/serving-inngest-functions , https://www.inngest.com/docs/reference/testing

v4 breaking changes that matter: triggers moved INTO the first arg (`triggers`), `EventSchemas` removed (use `eventType()`), default mode is cloud so local dev needs `isDev:true` or `INNGEST_DEV=1`, `step.invoke` needs function refs, checkpointing on by default.

```ts
// inngest/client.ts
import { Inngest, eventType } from "inngest";
import { z } from "zod";
export const inngest = new Inngest({ id: "escheat-agent", isDev: process.env.NODE_ENV !== "production" });
// (or env INNGEST_DEV=1; prod needs INNGEST_SIGNING_KEY + INNGEST_EVENT_KEY)

export const itemDormant = eventType("item/dormant", { schema: z.object({ itemId: z.string(), dueAt: z.string() }) });
export const letterApproved = eventType("letter/approved", { schema: z.object({ itemId: z.string() }) });

// inngest/functions.ts
export const dueDiligence = inngest.createFunction(
  {
    id: "due-diligence",
    triggers: [itemDormant],                       // or [{ event: "item/dormant", if: "event.data.dueAt != ''" }, { cron: "TZ=America/Chicago 0 9 * * *" }]
    retries: 3,
    cancelOn: [{ event: "item/cancelled", match: "data.itemId", timeout: "30d" }], // if cannot be combined with match
  },
  async ({ event, step }) => {
    const prep = await step.run("prepare-letter", async () => ({ id: event.data.itemId }));   // JSON-serializable result
    const approval = await step.waitForEvent("wait-letter-approval", {
      event: letterApproved,                       // or string "letter/approved"
      timeout: "7d",                               // string | ms | Date
      match: "data.itemId",                        // OR if: "event.data.itemId == async.data.itemId"  (never both; CEL has no `in`)
    });
    if (approval === null) return { status: "approval_timeout" };     // null = timed out
    await step.sleepUntil("until-report-deadline", new Date(event.data.dueAt));  // also step.sleep("id", "30d")
    await step.run("generate-report", () => { /* deterministic */ });
    return { status: "done", prep };
  },
);
export const nightly = inngest.createFunction({ id: "nightly-scan", triggers: [{ cron: "TZ=America/Chicago 0 2 * * *" }] }, async ({ step }) => { /* ... */ });

// app/api/inngest/route.ts
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { dueDiligence, nightly } from "@/inngest/functions";
export const { GET, POST, PUT } = serve({ client: inngest, functions: [dueDiligence, nightly] });
// export const maxDuration = 300; // Vercel; optional streaming: true in serve() options for long steps (Fluid compute)

// send events: await inngest.send(itemDormant.create({ itemId: "...", dueAt: "..." }));  // or { name, data }
```

Dev server: `npx inngest-cli@latest dev -u http://localhost:3000/api/inngest` (UI on http://localhost:8288). `-u` is documented for other frameworks; for Next it autodiscovers port 3000 routes at `/api/inngest`. Local app needs `INNGEST_DEV=1` (or `isDev:true`) and no keys.

Unit tests (VERIFIED against 4.26.1 + 1.0.0):

```ts
import { InngestTestEngine } from "@inngest/test";
const t = new InngestTestEngine({ function: dueDiligence });
const { result, error, ctx, state } = await t.execute({
  events: [{ name: "item/dormant", data: { itemId: "a", dueAt: "2030-01-01T00:00:00Z" } }],
  steps: [
    { id: "until-report-deadline", handler: () => null },  // sleep/sleepUntil: no-op mock WORKS
    { id: "generate-report", handler: () => "mock" },       // step.run mock WORKS
  ],
});
// asserts: ctx.step.run toHaveBeenCalledWith("prepare-letter", expect.any(Function)); await expect(state["prepare-letter"]).resolves...
// Run to ONE step and inspect options (works for waitForEvent registration):
const { step } = await t.executeStep("wait-letter-approval", { events: [...] });
// => { op: "WaitForEvent", name: "letter/approved", opts: { timeout: "1w", if: "event.data.itemId == async.data.itemId" } }
```

⚠️ `steps:[{ id: "wait-letter-approval", handler: ... }]` for `waitForEvent` throws `EventValidationError` in this version (VERIFIED). Workarounds: (1) assert the wait with `executeStep("wait-...")`; (2) put post-approval logic in a pure function tested directly; (3) cover the approve/timeout paths with Inngest dev-server integration tests, not the test engine. Mock sleeps and any waits; the engine otherwise tries to run real long waits. Other test engine options: `transformCtx`+`mockCtx`, `clone()`, constructor-level or per-call mocks.

Gotchas: step IDs must be stable; step results must be JSON-serializable (Dates become strings); code outside `step.run` re-runs on every resume, so keep it deterministic; Promise.race semantics changed in v4 (wrap in `group.parallel()`); do not use string function IDs in `step.invoke`.

---

## 3. Stagehand (`@browserbasehq/stagehand` pin 3.7.3)

Docs: https://docs.stagehand.dev/v3/configuration/browser (v3), https://docs.stagehand.dev/v4/first-steps/quickstart (v4), https://github.com/browserbase/stagehand

Recommended: Playwright launches the browser (headless, video, network fence), Stagehand v3 attaches over CDP. VERIFIED end to end (no model call): fence blocked an off-allowlist URL, Stagehand `page.goto` + `locator().click()` worked, and a `.webm` video was recorded.

```ts
import { chromium } from "playwright";
import { Stagehand } from "@browserbasehq/stagehand";   // 3.7.3
import { z } from "zod";

const REPLICA_ORIGIN = new URL(process.env.APP_BASE_URL!).origin;
const ctx = await chromium.launchPersistentContext("/tmp/escheat-ud", {      // persistent ctx => default context shared with CDP attach
  headless: true,
  recordVideo: { dir: "./artifacts/video", size: { width: 1280, height: 720 } },  // webm per page, finalised on ctx.close()
  args: ["--remote-debugging-port=9333"],
});
await ctx.route("**/*", (route) => {                                          // network fence: refuse non-replica URLs
  const u = route.request().url();
  return u.startsWith(REPLICA_ORIGIN) || u.startsWith("data:") || u.startsWith("about:") ? route.continue() : route.abort();
});

// Use the ws URL from /json/version. `http://localhost:9333` gave a 404 websocket error in testing; use 127.0.0.1 + ws url.
const { webSocketDebuggerUrl } = await (await fetch("http://127.0.0.1:9333/json/version")).json();
const stagehand = new Stagehand({
  env: "LOCAL",
  model: { modelName: "anthropic/claude-sonnet-4-6", apiKey: process.env.ANTHROPIC_API_KEY },  // "provider/model" format; see risk #8
  localBrowserLaunchOptions: { cdpUrl: webSocketDebuggerUrl },
  verbose: 0,
});
await stagehand.init();
const page = stagehand.context.pages()[0];          // Stagehand page: goto, locator, click(x,y), screenshot, waitForSelector, title, url...
await page.goto(`${REPLICA_ORIGIN}/replica/ca/login`);       // plain deterministic actions: page.locator("#x").fill/click
await page.locator("button[type=submit]").click();

await stagehand.act("click the Continue button");            // natural language action
const observed = await stagehand.observe("find the submit button"); // v3: array of {selector, description, method, arguments}; v4 wraps in {data}
const data = await stagehand.extract("extract the confirmation number", z.object({ confirmation: z.string() })); // zod-validated
const agent = stagehand.agent({ model: "anthropic/claude-sonnet-4-6" });                // multi-step; DOM/hybrid tool mode
const out = await agent.execute({ instruction: "Fill out the form ...", maxSteps: 20 });  // AgentResult (exact fields UNVERIFIED; check dist types). agent/act/extract/observe signatures read from 3.7.3 typings, not run against a model

await stagehand.close(); await ctx.close();           // ctx.close() flushes the video
```

Notes:
- v3 pure-Stagehand local mode (no Playwright): `new Stagehand({ env:"LOCAL", localBrowserLaunchOptions:{ headless:true, executablePath?, viewport, userDataDir, downloadsPath, acceptDownloads, port, args } })`, `await stagehand.init()`, `stagehand.context.pages()[0]`. It launches the installed Chrome via chrome-launcher; Playwright/Puppeteer are optional peers (only needed to pass their page objects to `act({page})`). No `route()`, no `recordVideo` in this mode.
- `observe()` returns real selectors, so credentials/synthetic PII can be typed with plain `page.locator(sel).fill()` without sending them to the model.
- Replica-only guard must also be enforced in our own code (assert URL origin before every `goto`); the route fence is defence in depth. Aborted navigations may not throw in `goto`; assert `page.url()`.
- v4 (4.3.0) equivalent: `const browser = await localBrowser.connect({ cdpUrl })` or `localBrowser.launch({ headless, executablePath })`; `Stagehand.create({ browser, model:{modelName,apiKey} })`; `const [page] = await browser.context.pages()`; `observe/extract` return `{ data }`. Keep zod at ~4.4.3. Requires Chrome installed.

---

## 4. MCP (`@modelcontextprotocol/sdk` 1.32.2)

Docs: https://modelcontextprotocol.io , https://github.com/modelcontextprotocol/typescript-sdk , https://code.claude.com/docs/en/mcp , https://github.com/vercel/mcp-handler

```ts
// shared: lib/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
export function buildServer() {
  const server = new McpServer({ name: "escheat-agent", version: "0.1.0" });
  server.registerTool(
    "what_is_owed",
    { title: "What is owed", description: "Items near escheatment by state", inputSchema: { state: z.enum(["CA", "DE", "TX"]).optional() } }, // raw Zod shape (v3 or v4 zod ok)
    async ({ state }) => ({ content: [{ type: "text", text: JSON.stringify(await queryOwed(state)) }] }),
  );
  return server;
}

// stdio: scripts/mcp-stdio.ts  (run: npx tsx scripts/mcp-stdio.ts). NEVER console.log to stdout; use console.error.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
await buildServer().connect(new StdioServerTransport());

// Streamable HTTP in a Next.js App Router route: app/api/mcp/route.ts  (VERIFIED: initialize + tools/call returned correct JSON)
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
export const runtime = "nodejs";
async function handle(req: Request): Promise<Response> {
  if (req.headers.get("authorization") !== `Bearer ${process.env.MCP_TOKEN}`) return new Response("unauthorized", { status: 401 });
  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true }); // stateless, JSON replies (serverless friendly)
  await server.connect(transport);
  return transport.handleRequest(req);          // new server+transport per request in stateless mode
}
export { handle as GET, handle as POST, handle as DELETE };
```

Alternative: `mcp-handler` (Vercel Labs, Apache-2.0). 2.3.0 = `createMcpHandler((server) => { server.registerTool(...) })`, `export { handler as GET, handler as POST }`; requires `@modelcontextprotocol/server@^2` + zod ^4.2 + Node 20+ (MCP v2 packages, a different API). With sdk 1.x use `mcp-handler@1.1.0`. Not needed given the web-standard transport above.

Add to Claude Code:
```bash
# stdio (options before the name, server command after --)
claude mcp add --transport stdio --scope project escheat --env DATABASE_URL=... -- npx tsx scripts/mcp-stdio.ts
# http
claude mcp add --transport http escheat http://localhost:3000/api/mcp --header "Authorization: Bearer $MCP_TOKEN"
claude mcp list
```
Project `.mcp.json`: `{"mcpServers":{"escheat":{"type":"http","url":"http://localhost:3000/api/mcp","headers":{"Authorization":"Bearer ${MCP_TOKEN}"}}}}` (an entry with `url` but no `type` is an error; entries without `type` are read as stdio).

Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`): stdio only in this file; for an HTTP server use the `mcp-remote` bridge (UNVERIFIED against current Desktop; newer Desktop also supports adding remote servers as Connectors in Settings):
```json
{ "mcpServers": {
  "escheat": { "command": "npx", "args": ["-y", "tsx", "/abs/path/escheat-agent/scripts/mcp-stdio.ts"], "env": { "DATABASE_URL": "..." } },
  "escheat-http": { "command": "npx", "args": ["-y", "mcp-remote", "http://localhost:3000/api/mcp", "--header", "Authorization: Bearer ${MCP_TOKEN}"], "env": { "MCP_TOKEN": "..." } }
} }
```
Gotchas: in stateless mode create a fresh server per request; keep tool output text/JSON; stdout is protocol-only for stdio; `Accept: application/json, text/event-stream` is required by clients on POST.

---

## 5. Lob (`@lob/lob-typescript-sdk` 1.4.2)

Docs: https://github.com/lob/lob-typescript-sdk , https://docs.lob.com/#tag/Letters , https://help.lob.com/print-and-mail/getting-data-and-results/using-webhooks

The TS SDK is the current one; `lob` (8.x) is the legacy JS SDK.

```ts
import { Configuration, LettersApi, LetterEditable, AddressEditable, LtrUseType } from "@lob/lob-typescript-sdk";
const cfg = new Configuration({ username: process.env.LOB_TEST_API_KEY });   // must start with "test_"; refuse "live_"
if (!process.env.LOB_TEST_API_KEY?.startsWith("test_")) throw new Error("Lob test key required");
const letters = new LettersApi(cfg);

const letter = await letters.create(
  new LetterEditable({
    description: "Due diligence notice item 10482 (SYNTHETIC)",
    to: new AddressEditable({ name: "Bayline Electric", address_line1: "...", address_city: "...", address_state: "CA", address_zip: "94105", address_country: "US" }),
    from: new AddressEditable({ name: "Northwind Fixtures, Inc.", address_line1: "...", address_city: "...", address_state: "TX", address_zip: "78701", address_country: "US" }),
    file: "<html><body>...{{name}}...</body></html>",   // HTML string, template id, or URL to PDF; merge_variables fills {{vars}}
    merge_variables: { name: "Bayline Electric" },
    color: false,                                        // required
    use_type: LtrUseType.Operational,                    // required: "marketing" | "operational" (null only if account default set)
    mail_type: "usps_first_class",
    metadata: { item_id: "10482" },
  }),
  idempotencyKey,                                        // 2nd arg: dedupe retries
);
letter.id;   // "ltr_..."
letter.url;  // signed HTTPS link to the rendered PDF preview (expires after 30 days; each GET mints a new one)
letter.expected_delivery_date;
```
- Addresses: required `name` or `company`, `address_line1`, and city/state/zip for US (or `address_zip` only formats vary). `to`/`from` can also be saved address ids (`adr_...`).
- HTML content: 8.5x11 letter; leave address window space or use `address_placement: "insert_blank_page"` (default `top_first_page` writes address on page 1).
- Test mode: no mail is printed or sent; PDFs render; `tracking_events` NOT populated and tracking event types cannot be subscribed to in Test. No magic simulation for letters. Only the dashboard Debugger emits fake events (verify those with HMAC secret `secret`).
- Webhook signature (Lob docs): headers `Lob-Signature` and `Lob-Signature-Timestamp`; signature = hex(HMAC-SHA256(key = webhook secret from dashboard, message = `${timestamp}.${rawBody}`)); compare timing-safe; recommended 5 minute tolerance; timestamp unit not documented (assume epoch; verify on first real event). Use the raw body (`await req.text()`), not re-serialized JSON.
```ts
import { createHmac, timingSafeEqual } from "node:crypto";
export function verifyLob(raw: string, sig: string, ts: string, secret: string) {
  const exp = createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
  return sig.length === exp.length && timingSafeEqual(Buffer.from(sig), Buffer.from(exp));
}
```
Gotchas: test-mode lets you test webhooks only for events from your test key (non-tracking types, e.g. letter.created, letter.rendered_pdf); mail is never real, so keep "Prototype" copy on all rendered letters. Rate/price in test = free.

---

## 6. Resend (`resend` 6.35.0)

Docs: https://resend.com/docs/api-reference/emails/send-email , https://resend.com/docs/webhooks/verify-webhooks-requests , https://resend.com/docs/dashboard/receiving/introduction , https://resend.com/docs/dashboard/emails/send-test-emails

```ts
import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY);
const { data, error } = await resend.emails.send(
  { from: process.env.RESEND_FROM!, /* "Escheat Agent <onboarding@resend.dev>" */ to: [recipient], subject: "...", html: "<p>...</p>", text: "...", tags: [{ name: "item", value: "10482" }] },
  { idempotencyKey: `item-10482-notice-1` },   // sent as Idempotency-Key header (24 h)
);
if (error) throw new Error(error.message);     // SDK returns {data,error}; it does not throw
```
- Sender rules: `onboarding@resend.dev` works with no domain but only delivers to the account owner's email (see difference #10) plus `*@resend.dev` test addresses. A custom From requires a verified domain (DNS records). Enforce ALLOWED_TEST_RECIPIENTS in code before calling.
- Webhooks (Svix): headers `svix-id`, `svix-timestamp`, `svix-signature`; secret from webhook details page; use the raw body.
```ts
// app/api/webhooks/resend/route.ts
export async function POST(req: Request) {
  const payload = await req.text();
  try {
    const event = resend.webhooks.verify({ payload, headers: { id: req.headers.get("svix-id")!, timestamp: req.headers.get("svix-timestamp")!, signature: req.headers.get("svix-signature")! }, webhookSecret: process.env.RESEND_WEBHOOK_SECRET! });
    // event.type: email.sent | delivered | bounced | complained | opened | clicked | failed | delivery_delayed | scheduled | suppressed | received
  } catch { return new Response("invalid", { status: 400 }); }
  return new Response("ok");
}
// alternative: import { Webhook } from "svix"; new Webhook(secret).verify(payload, svixHeaders)
```
- Inbound: supported. Event `email.received`; add MX record for a custom (or Resend-provided) receiving domain; fetch body with `resend.emails.receiving.get(id)` (also `.list`, `.forward`, attachments). Webhook payload carries metadata only; fetch content separately. Treat as optional for the demo; use a simulated reply endpoint if no domain.

---

## 7. Vapi outbound calls (plain `fetch`, no SDK)

Docs: https://docs.vapi.ai/api-reference/calls/create , https://docs.vapi.ai/api-reference/calls/get , https://docs.vapi.ai/api-reference/assistants/get , https://docs.vapi.ai/api-reference/phone-numbers/get (checked against the OpenAPI spec at https://api.vapi.ai/api-json)

Setup: (1) import or buy a phone number in the Vapi dashboard (VAPI_PHONE_NUMBER_ID), (2) optionally create an assistant (VAPI_ASSISTANT_ID; otherwise the app sends an inline, tool-free assistant built from the approved script). Auth: `Authorization: Bearer <private key>`, base `https://api.vapi.ai`.

- `POST /call` body: `{ phoneNumberId, customer: { number }, assistantId | assistant, assistantOverrides: { variableValues } }` -> `Call` with `id`, `status`. No idempotency key exists and we never retry; the persisted `callAttempt` marker is the guard. 400 = client/policy failure (safe to release the approval); 5xx/timeouts leave the outcome unknown.
- `GET /call/{id}`: `status` is `scheduled | queued | ringing | in-progress | forwarding | ended`; `artifact.messages[]` (also top-level `messages[]`) hold `{ role: "user" | "bot" | "system" | tool roles, message, secondsFromStart }`; there is NO top-level `transcript` (it is `artifact.transcript`, a string). `analysis.summary`, `startedAt`, `endedAt`, `endedReason`.
- `GET /assistant/{id}`: `model.tools[]` (types include `transferCall`, `handoff`), `model.toolIds`, `model.toolRefs`, `hooks`. There is no `forwardingPhoneNumber` field in the current spec; the check still rejects it if present.
- `GET /phone-number/{id}`: `provider` (`twilio | vonage | telnyx | vapi | byo-phone-number`), `number` (absent for some vapi/byo numbers).
- Inline assistant model: Anthropic `claude-haiku-5-5` (in Vapi's `AnthropicModel` enum). Needs an Anthropic credential on the Vapi org (UNVERIFIED here).

---

## 8. QuickBooks Online (`intuit-oauth` 4.2.5)

Docs: https://github.com/intuit/oauth-jsclient , https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/purchase (JS-rendered; fields below confirmed from Intuit's Java SDK models, https://github.com/intuit/QuickBooks-V3-Java-SDK)

```ts
import OAuthClient from "intuit-oauth";           // CommonJS lib; types in package (types/index.d.ts)
const oauth = new OAuthClient({ clientId: process.env.QBO_CLIENT_ID!, clientSecret: process.env.QBO_CLIENT_SECRET!, environment: "sandbox", redirectUri: process.env.QBO_REDIRECT_URI! });

// 1. send user to:
const url = oauth.authorizeUri({ scope: [OAuthClient.scopes.Accounting], state: csrfToken });
// 2. callback route receives ?code=...&realmId=...&state=... ; pass the FULL redirect URL
const tokenRes = await oauth.createToken(req.url);     // full URL string incl. query
const token = tokenRes.getToken();                     // { access_token, refresh_token, expires_in (3600s), x_refresh_token_expires_in, realmId, ... }
// persist token + realmId (encrypted) ; later:
oauth.setToken(storedToken);
if (!oauth.isAccessTokenValid()) { const r = await oauth.refresh(); persist(r.getToken()); }   // ALWAYS store the newest refresh_token (old one dies 24 h later)

// 3. query
const base = "https://sandbox-quickbooks.api.intuit.com";    // production: https://quickbooks.api.intuit.com
const q = encodeURIComponent("select * from Purchase where PaymentType = 'Check' startposition 1 maxresults 1000");
const resp = await oauth.makeApiCall({ url: `${base}/v3/company/${realmId}/query?query=${q}&minorversion=75`, method: "GET", headers: { Accept: "application/json" } });
const purchases = resp.json?.QueryResponse?.Purchase ?? [];   // resp.json (parsed) or JSON.parse(resp.body)
```
Purchase fields (PaymentType enum `Cash|Check|CreditCard`):
- `Id`, `SyncToken`, `DocNumber` (check number; may be absent), `TxnDate` (YYYY-MM-DD), `TotalAmt` (number), `PaymentType: "Check"`, `AccountRef {value,name}` (bank account), `EntityRef {value,name,type:"Vendor"}` (payee; may also be Customer/Employee), `PrintStatus` (`NotSet|NeedToPrint|PrintComplete`), `PrivateNote`, `Credit` (bool), `Line[]`, `CheckPayment`, `MetaData {CreateTime,LastUpdatedTime}`, `domain`.
- Voided checks: QBO voids by zeroing; expect `TotalAmt` 0 and `PrivateNote` "Voided" (UNVERIFIED from memory; confirm in the sandbox). Filter these in code.
- No cleared/reconciled field. Clearing status is not exposed by the API.
- Vendor address: read the Vendor by id: `GET {base}/v3/company/{realmId}/vendor/{EntityRef.value}` or `select * from Vendor where Id = '58'`. Fields: `DisplayName`, `PrintOnCheckName`, `CompanyName`, `BillAddr { Id, Line1..Line5, City, CountrySubDivisionCode (state), PostalCode, Country }`, `PrimaryEmailAddr`, `Active`. Batch with `select * from Vendor where Id in ('1','2',...)`.
- Query limits: default 100 rows, max 1000 per page (`startposition`/`maxresults`); query `Content-Type` documented as `application/text` for POST queries; GET works with the `query` param.
Gotchas: sandbox company must be created at developer.intuit.com; sandbox and production use different keys/redirect URIs; access token 60 min, refresh token rolls (store the new one every refresh); `minorversion` optional but recommended (newest accepted values change; 75 is what the Intuit docs referenced most recently, UNVERIFIED, omit if it errors). `node-quickbooks` (2.0.50) is an optional convenience wrapper (`findPurchases([{field:'PaymentType',value:'Check'}])`); plain `makeApiCall` is enough.

---

## 9. Plaid (`plaid` 49.0.0)

Docs: https://plaid.com/docs/api/products/transactions/#transactionssync , https://plaid.com/docs/sandbox/user-custom/

```ts
import { Configuration, PlaidApi, PlaidEnvironments, Products } from "plaid";
const plaid = new PlaidApi(new Configuration({
  basePath: PlaidEnvironments.sandbox,           // https://sandbox.plaid.com
  baseOptions: { headers: { "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!, "PLAID-SECRET": process.env.PLAID_SECRET! } },
}));
// sandbox shortcut: no Link UI needed
const { data: pub } = await plaid.sandboxPublicTokenCreate({ institution_id: "ins_109508", initial_products: [Products.Transactions] }); // First Platypus Bank
const { data: ex } = await plaid.itemPublicTokenExchange({ public_token: pub.public_token });
let cursor: string | undefined; const added = [];
for (;;) {
  const { data } = await plaid.transactionsSync({ access_token: ex.access_token, cursor, count: 500 });
  added.push(...data.added); /* also data.modified, data.removed */
  cursor = data.next_cursor; if (!data.has_more) break;     // persist cursor
}
// each transaction: transaction_id, account_id, amount, date, name, merchant_name, pending, check_number (string|null), payment_channel, personal_finance_category ...
```
- `check_number`: present on the Transaction model (`string | null`, "only populated for check transactions"). Custom sandbox users (`user_custom`) accept only `date_transacted, date_posted, amount, description, currency`, so you cannot seed check numbers; assume null in sandbox and match by amount/date/description (UNVERIFIED for default sandbox users; add a unit test with a fixture that has `check_number`).
- On first call right after link, `/transactions/sync` may return empty until the initial pull completes (webhook `SYNC_UPDATES_AVAILABLE`, or `sandboxItemFireWebhook`); retry with backoff.
- Plaid is optional per the brief; skip gracefully when keys are missing.

---

## 10. Drizzle ORM (0.45.4) + PGlite + Neon

Docs: https://orm.drizzle.team/docs/connect-pglite , https://orm.drizzle.team/docs/connect-neon , https://orm.drizzle.team/docs/migrations

```ts
// db/index.ts: choose driver at runtime
import * as schema from "./schema";
export async function getDb() {
  if (process.env.DATABASE_URL) {
    const { drizzle } = await import("drizzle-orm/neon-serverless");
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    // Node (not edge): neonConfig.webSocketConstructor = (await import("ws")).default;   // needs `ws` (+ optional bufferutil)
    return drizzle({ client: new Pool({ connectionString: process.env.DATABASE_URL }), schema });
  }
  const { drizzle } = await import("drizzle-orm/pglite");
  return drizzle(process.env.PGLITE_DIR ?? "./.pglite", { schema });   // drizzle() with no arg = in-memory (tests)
}
```
Driver choice for Vercel: `neon-http` (`drizzle-orm/neon-http`, `drizzle(process.env.DATABASE_URL!)`) is fastest for single, non-interactive queries but does NOT support interactive transactions. `neon-serverless` (WebSocket Pool) supports sessions and interactive `db.transaction()`; Node runtime needs `ws`; edge runtime needs none. Recommendation: use `neon-serverless` Pool (our flows need transactions for the approval/audit writes); create the Pool inside request scope or module scope with care for serverless connection limits (Neon pooled connection string).

Migrations (VERIFIED for pglite on 0.45.4 + drizzle-kit 0.31.11):
```ts
// scripts/migrate.ts
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migrateNeon } from "drizzle-orm/neon-serverless/migrator";
await migratePglite(db, { migrationsFolder: "./drizzle" });     // pglite; works on in-memory db for tests
await migrateNeon(db, { migrationsFolder: "./drizzle" });       // neon-serverless (neon-http/migrator also exists)
```
- Generate: `drizzle-kit generate --config=drizzle.config.ts` with `export default { dialect: "postgresql", schema: "./db/schema.ts", out: "./drizzle" }`. Apply with the runtime `migrate()` above (works for both drivers) or `drizzle-kit migrate`.
- Test pattern: `const db = drizzle(); await migrate(db, { migrationsFolder: "./drizzle" });` per test file (fresh in-memory PGlite, ~100s of ms).
- Gotchas: `generatedAlwaysAsIdentity()` works in PGlite; avoid Postgres extensions PGlite lacks (pg_cron, etc.); use the same schema file for both drivers; keep types as `PgDatabase`-compatible (`import type { PgDatabase } from "drizzle-orm/pg-core"`) in repository code so both drivers fit; `DATABASE_URL_TEST` can point to a Neon branch for integration tests.
