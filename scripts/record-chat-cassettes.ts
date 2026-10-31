/**
 * `pnpm chat:record` - records the demo chat prompts as cassettes in fixtures/cassettes/chat/ so /chat works with
 * ESCHEAT_OFFLINE=1. Needs ANTHROPIC_API_KEY and a seeded DB (PGLITE_DATA_DIR=... pnpm seed:demo).
 *
 * It drives runChatTurn directly with ESCHEAT_RECORD=1. Chat tools can only read, draft and generate; none
 * approve, send, call or file, so recording is safe. Each model call is stored under a normalized request key
 * (see src/lib/chat/replay-key.ts), so replay works on any DB seeded with the same data.
 *
 * Record against a DB seeded the same way as the offline demo path (heuristic classifier), so tool results match:
 *   ANTHROPIC_API_KEY= PGLITE_DATA_DIR=.data/pglite-rec pnpm seed:demo   # then export the key and run chat:record
 */
import { existsSync } from "node:fs";
import { closeDb } from "../src/db/client";
import type { ChatEvent, ChatMessage } from "../src/lib/chat/protocol";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

/** Single-turn prompts, then the demo's multi-turn conversation (each turn sends the real prior reply back). */
const SINGLE_TURNS = [
  "What do we owe in unclaimed property, and where?",
  "What's due in the next 90 days?",
  "Explain check #10482",
  "Which rules are unverified?",
  "Draft the due-diligence letter for #10482",
  "Generate the CA report",
];
const DEMO_CONVERSATION = ["What do we owe and where?", "Explain check #10482", "Draft the due-diligence letter for #10482"];

async function main(): Promise<number> {
  const verify = process.argv.includes("--verify");
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

  if (verify) {
    // A prompt that was never recorded must give the honest "no recorded answer" state, not an invented one.
    await turn([{ role: "user", text: "What is the weather in Paris?" }]);
    failed -= 1;
  }
  for (const prompt of SINGLE_TURNS) await turn([{ role: "user", text: prompt }]);

  const transcript: ChatMessage[] = [];
  for (const prompt of DEMO_CONVERSATION) {
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
