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
    for (const q of ["", "   ", "What is the weather in Paris?", "Set up outreach", "set up letters for everything due", "What do we owe and where?", "Explain check #10482"]) {
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

  describe("approval cards (slice 4)", () => {
    it.each([
      ["Review approvals", "review_approvals"],
      ["review my approvals", "review_approvals"],
      ["What needs my approval?", "review_approvals"],
      ["what needs approval", "review_approvals"],
      ["approve letters", "review_approvals"],
      ["Approve the pending drafts", "review_approvals"],
      ["show pending approvals", "review_approvals"],
      ["Draft letters", "draft_outreach"],
      ["draft outreach for #10087", "draft_outreach"],
      ["Draft notices for Ravenhill", "draft_outreach"],
      ["Close the month", "close_month"],
      ["close the books", "close_month"],
      ["Close October 2026", "close_month"],
      ["close november", "close_month"],
      ["File the CA report", "file_report"],
      ["submit the Texas report", "file_report"],
      ["file the report", "file_report"],
    ])("%s -> %s", (q, id) => {
      expect(idOf(q)).toBe(id);
    });

    it("passes what the user typed, never a computed date or a legal value", () => {
      expect(matchCardIntent("Close October 2026")?.calls[0]).toEqual({ name: "prepare_period_close", input: { month: "october", year: 2026 } });
      expect(matchCardIntent("close november")?.calls[0]?.input).toEqual({ month: "november" });
      expect(matchCardIntent("Close the month")?.calls[0]?.input).toEqual({});
      expect(matchCardIntent("File the CA report")?.calls[0]).toEqual({ name: "prepare_filing", input: { state: "CA" } });
      expect(matchCardIntent("file the tx report")?.calls[0]?.input).toEqual({ state: "TX" });
      expect(matchCardIntent("submit the Delaware report")?.calls[0]?.input).toEqual({ state: "DE" });
      expect(matchCardIntent("draft outreach for #10087")?.calls[0]).toEqual({ name: "prepare_outreach", input: { item: "10087" } });
      expect(matchCardIntent("Draft notices for Ravenhill")?.calls[0]?.input).toEqual({ item: "ravenhill" });
      expect(matchCardIntent("draft letters for everything due")?.calls[0]?.input).toEqual({});
      expect(matchCardIntent("Review approvals")?.calls[0]).toEqual({ name: "review_approvals", input: {} });
    });

    it("does not steal the model's or the offline answers' prompts", () => {
      for (const q of [
        "Close out California for this cycle",
        "Close out Texas",
        "close the cycle for DE",
        "Draft the due-diligence letter for #10087",
        "Draft the letter for #10087",
        "Generate the CA report",
        "Approve the CA report",
        "What's the status of the CA report?",
        "Explain check #10087",
        "What's overdue?",
        "What needs me?",
        "Set up outreach",
        "Upload a ledger CSV",
      ]) {
        const id = idOf(q);
        expect(["review_approvals", "draft_outreach", "close_month", "file_report"], q).not.toContain(id);
      }
      expect(idOf("What's overdue?")).toBe("needs_you");
      expect(idOf("Upload a ledger CSV")).toBe("import_csv");
    });
  });
});
