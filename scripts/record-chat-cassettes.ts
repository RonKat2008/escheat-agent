/**
 * `pnpm chat:record` - records the demo chat prompts as cassettes in fixtures/cassettes/chat/ so /chat works with
 * ESCHEAT_OFFLINE=1.
 *
 * It drives runChatTurn directly with ESCHEAT_RECORD=1. Chat tools can only read, draft and generate; none
 * approve, send, call or file, so recording is safe. Each model call is stored under a normalized request key
 * (see src/lib/chat/replay-key.ts), so replay works on any DB seeded with the same data.
 *
 * It seeds its own fresh DB per prompt group (heuristic classifier, like the offline demo), so just run
 * `pnpm chat:record` (needs the key in .env.local) and `pnpm chat:verify` (keyless replay).
 */
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { closeDb } from "../src/db/client";
import type { ChatEvent, ChatMessage } from "../src/lib/chat/protocol";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
// Record and verify as the demo runs (`next dev`): tool results such as letter readiness depend on the dev owner-link secret.
if (!process.env.NODE_ENV) Object.assign(process.env, { NODE_ENV: "development" });

/**
 * Prompt groups. Each group is recorded (and verified) against its OWN freshly seeded database, because some prompts
 * change data (a draft, a report) and the replay key includes tool results: a group recorded after another group's
 * writes would only replay in that exact order, and the demo always starts from a fresh seed (dogfood R3-01).
 * Read-only prompts share one group; each multi-turn conversation sends the real prior reply back.
 */
const GROUPS: Record<string, { singles?: string[]; conversation?: string[] }> = {
  reads: {
    singles: [
      "What do we owe in unclaimed property, and where?",
      "What's due in the next 90 days?",
      "Explain check #10482",
      "Which rules are unverified?",
    ],
  },
  demo: { conversation: ["What do we owe and where?", "Explain check #10482", "Draft the due-diligence letter for #10482"] },
  draft: { singles: ["Draft the due-diligence letter for #10482"] },
  report: { singles: ["Generate the CA report"] },
  // The empty state's guided close-out chips (plan_close_out).
  closeout: { singles: ["Close out California for this cycle", "Close out Delaware for this cycle", "Close out Texas for this cycle"] },
};

/**
 * Without --group: for each group, seed a fresh DB (keyless, heuristic classifier, like the offline demo) and run this
 * script again for that group. Seeding runs in its own process because PGlite is single-process.
 */
function orchestrate(verify: boolean): number {
  const dir = process.env.PGLITE_DATA_DIR?.trim() || ".data/pglite-cassettes";
  let failed = 0;
  for (const group of Object.keys(GROUPS)) {
    rmSync(dir, { recursive: true, force: true });
    execFileSync("pnpm", ["seed:demo"], { stdio: "ignore", shell: true, env: { ...process.env, PGLITE_DATA_DIR: dir, ANTHROPIC_API_KEY: "" } });
    const args = ["tsx", "scripts/record-chat-cassettes.ts", "--group", group, ...(verify ? ["--verify"] : [])];
    const env = { ...process.env, PGLITE_DATA_DIR: dir, ...(verify ? { ANTHROPIC_API_KEY: "" } : {}) };
    try {
      execFileSync("pnpm", ["exec", ...args], { stdio: "inherit", shell: true, env });
    } catch {
      failed++;
    }
  }
  rmSync(dir, { recursive: true, force: true });
  return failed ? 1 : 0;
}

async function main(): Promise<number> {
  const verify = process.argv.includes("--verify");
  const groupArg = process.argv[process.argv.indexOf("--group") + 1];
  if (!process.argv.includes("--group")) return orchestrate(verify);
  const group = GROUPS[groupArg ?? ""];
  if (!group) {
    console.error(`Unknown group "${groupArg}". Groups: ${Object.keys(GROUPS).join(", ")}`);
    return 1;
  }
  console.log(`-- group ${groupArg}`);
  if (verify) process.env.ESCHEAT_OFFLINE = "1";
  else process.env.ESCHEAT_RECORD = "1";
  if (!verify) delete process.env.ESCHEAT_OFFLINE;
  const { DEMO_ANCHOR_DATE } = await import("../src/lib/synthetic/model");
  process.env.DEMO_ANCHOR_DATE ||= DEMO_ANCHOR_DATE;
  const { runChatTurn, chatAvailability } = await import("../src/lib/chat/agent");
  const { getOutreachDb } = await import("../src/lib/outreach/db");
  const { resolveCompanyId } = await import("../src/lib/pipeline/company");
  if (chatAvailability() !== (verify ? "offline" : "ready")) {
    console.error("Need ANTHROPIC_API_KEY to record (or --verify with no key, which replays offline).");
    return 1;
  }
  const db = await getOutreachDb();
  const companyId = await resolveCompanyId(db);
  if (!companyId) {
    console.error("No company. Run pnpm seed:demo first.");
    return 1;
  }

  let inTokens = 0;
  let outTokens = 0;
  let costMicros = 0;
  let failed = 0;
  const turn = async (messages: ChatMessage[]): Promise<ChatMessage> => {
    const events: ChatEvent[] = [];
    await runChatTurn({ db, companyId, messages, emit: (e) => events.push(e) });
    const err = events.find((e): e is Extract<ChatEvent, { type: "error" }> => e.type === "error");
    const done = events.find((e): e is Extract<ChatEvent, { type: "done" }> => e.type === "done");
    const text = events.filter((e): e is Extract<ChatEvent, { type: "text" }> => e.type === "text").map((e) => e.delta).join("");
    const tools = events.filter((e): e is Extract<ChatEvent, { type: "tool_result" }> => e.type === "tool_result").map((e) => `${e.name}: ${e.summary}`);
    inTokens += done?.usage.inputTokens ?? 0;
    outTokens += done?.usage.outputTokens ?? 0;
    costMicros += done?.usage.costUsdMicros ?? 0;
    const last = messages.at(-1);
    console.log(`${err ? "FAIL" : "ok  "} ${last?.role === "user" ? last.text : ""} -> [${tools.join(", ")}] ${err ? `(${err.message})` : ""}`);
    if (err) failed++;
    return { role: "assistant", text, toolContext: done?.toolContext };
  };

  if (verify && groupArg === "reads") {
    // A prompt that was never recorded must give the honest "no recorded answer" state, not an invented one.
    await turn([{ role: "user", text: "What is the weather in Paris?" }]);
    failed -= 1;
  }
  for (const prompt of group.singles ?? []) await turn([{ role: "user", text: prompt }]);

  const transcript: ChatMessage[] = [];
  for (const prompt of group.conversation ?? []) {
    transcript.push({ role: "user", text: prompt });
    transcript.push(await turn([...transcript]));
  }

  console.log(`Tokens: ${inTokens} in, ${outTokens} out. Cost: $${(costMicros / 1_000_000).toFixed(4)}`);
  return failed ? 1 : 0;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
