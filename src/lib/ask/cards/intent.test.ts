import { describe, expect, it } from "vitest";
import { matchOfflineIntent } from "@/lib/chat/offline-intent";
import { RECORDED_CHAT_GROUPS } from "@/lib/chat/recorded-prompts";
import { EXAMPLE_PROMPTS } from "@/components/chat/followups";
import { isCardPrompt, matchCardIntent } from "./intent";
import { ASK_CARDS, BANK_CLEARS_PROMPT } from "./registry";

const idOf = (q: string) => matchCardIntent(q)?.id ?? null;

describe("matchCardIntent", () => {
  it.each([
    ["upload", "import_csv"],
    ["Upload a ledger CSV", "import_csv"],
    ["import a csv", "import_csv"],
    ["I want to upload my check register", "import_csv"],
    ["help me upload a csv", "import_csv"],
    ["set up", "integrations"],
    ["Set up integrations", "integrations"],
    ["connect", "integrations"],
    ["Connect QuickBooks", "integrations"],
    ["integrations", "integrations"],
    ["How do I turn on Plaid?", "integrations"],
    ["what's overdue", "needs_you"],
    ["What’s overdue?", "needs_you"],
    ["What needs me?", "needs_you"],
    ["anything past due?", "needs_you"],
    ["get started", "getting_started"],
    ["Getting started", "getting_started"],
    ["help", "getting_started"],
    ["where do I start?", "getting_started"],
  ])("%s -> %s", (q, id) => {
    expect(idOf(q)).toBe(id);
  });

  it("calls the registered tool, with the import kind the user typed", () => {
    expect(matchCardIntent("Upload a ledger CSV")).toEqual({ id: "import_csv", calls: [{ name: "start_import", input: { kind: "ledger" } }] });
    expect(matchCardIntent(BANK_CLEARS_PROMPT)?.calls[0]?.input).toEqual({ kind: "clears" });
    expect(matchCardIntent("upload the bank statement csv")?.calls[0]?.input).toEqual({ kind: "clears" });
    expect(matchCardIntent("set up integrations")?.calls[0]?.name).toBe("get_integrations");
    expect(matchCardIntent("what's overdue?")?.calls[0]?.name).toBe("list_overdue");
    expect(matchCardIntent("get started")?.calls[0]?.name).toBe("get_started");
  });

  it("keeps today's behaviour for anything else", () => {
    for (const q of ["", "   ", "What is the weather in Paris?", "Set up outreach", "set up letters for everything due", "Close October 2026", "What do we owe and where?", "Explain check #10482"]) {
      expect(matchCardIntent(q), q).toBeNull();
    }
  });

  it("never takes over a recorded prompt, an example chip or an existing direct offline answer", () => {
    const recorded = Object.values(RECORDED_CHAT_GROUPS).flatMap((g) => [...(g.singles ?? []), ...(g.conversation ?? [])]);
    // The verify-only "changed" scenario in scripts/record-chat-cassettes.ts also asks these.
    const verify = ["What do we still owe?", "What is the weather in Paris?"];
    for (const q of [...recorded, ...verify, ...EXAMPLE_PROMPTS]) expect(matchCardIntent(q), q).toBeNull();
    for (const card of ASK_CARDS) expect(matchOfflineIntent(card.prompt), card.prompt).toBeNull();
  });

  it("each card's canonical prompt opens that card", () => {
    for (const card of ASK_CARDS) {
      expect(idOf(card.prompt), card.prompt).toBe(card.id);
      expect(isCardPrompt(card.prompt)).toBe(true);
    }
  });

  it("is deterministic", () => {
    const q = "help me set up integrations";
    expect(matchCardIntent(q)).toEqual(matchCardIntent(q));
    expect(idOf(q)).toBe("integrations");
  });
});
