/**
 * The Ask action-card registry (docs/ASK-MODE.md §2, slice 3). One entry per card: the stable id the intent matcher
 * returns, the server tool that builds it, the `ui.kind` the client renders, and the canonical prompt its chips send.
 *
 * Today these tools are reached only without a model (the deterministic intents in ./intent.ts). They are deliberately
 * NOT in CHAT_TOOLS, because the model's tool list is part of every recorded cassette key. When a key exists, slice 2
 * exposes them to the model by appending `ASK_CARD_TOOLS` (./tools.ts) to CHAT_TOOLS and re-recording once; nothing
 * here changes.
 *
 * Pure and client-safe.
 */

export type AskCardId = "import_csv" | "integrations" | "needs_you" | "getting_started";

export interface AskCardEntry {
  id: AskCardId;
  /** Server tool name (./tools.ts). Never starts with approve_/send_/file_/submit_/pay_/close_period_/adopt_. */
  tool: string;
  /** The `ui.kind` the tool returns (src/lib/chat/ui-types.ts). */
  kind: "import_card" | "integrations_card" | "overdue" | "getting_started";
  /** What its chips and deep links send. Must match its own intent (tested). */
  prompt: string;
  /** Short name, for the card header and the working chip. */
  title: string;
}

export const ASK_CARDS: readonly AskCardEntry[] = [
  { id: "getting_started", tool: "get_started", kind: "getting_started", prompt: "Get started", title: "Getting started" },
  { id: "import_csv", tool: "start_import", kind: "import_card", prompt: "Upload a ledger CSV", title: "Upload a CSV" },
  { id: "needs_you", tool: "list_overdue", kind: "overdue", prompt: "What's overdue?", title: "What needs you" },
  { id: "integrations", tool: "get_integrations", kind: "integrations_card", prompt: "Set up integrations", title: "Integrations" },
];

export const ASK_CARD_TOOL: Readonly<Record<AskCardId, string>> = Object.fromEntries(ASK_CARDS.map((c) => [c.id, c.tool])) as Record<AskCardId, string>;

export const askCard = (id: AskCardId): AskCardEntry => ASK_CARDS.find((c) => c.id === id)!;

/** Canonical prompts, for chips and `/ask?q=` deep links. */
export const CARD_PROMPT: Readonly<Record<AskCardId, string>> = Object.fromEntries(ASK_CARDS.map((c) => [c.id, c.prompt])) as Record<AskCardId, string>;
export const BANK_CLEARS_PROMPT = "Import bank clears";
