import { describe, expect, it } from "vitest";
import { anthropicToolDefinitions, CHAT_TOOLS } from "@/lib/chat/tools";
import { CHAT_SYSTEM_PROMPT } from "@/lib/chat/system-prompt";
import { ASK_CARD_TOOL, ASK_CARDS, CARD_PROMPT, askCard } from "./registry";
import { ASK_CARD_TOOLS, getAskCardTool } from "./tools";

const FORBIDDEN = /^(approve|send|file|submit|pay|close_period|adopt)_/;

describe("Ask card registry", () => {
  it("has one entry per card, with unique ids, tools, kinds and prompts", () => {
    for (const key of ["id", "tool", "kind", "prompt"] as const) {
      const values = ASK_CARDS.map((c) => c[key]);
      expect(new Set(values).size, key).toBe(values.length);
    }
    expect(ASK_CARD_TOOL.import_csv).toBe("start_import");
    expect(CARD_PROMPT.getting_started).toBe("Get started");
    expect(askCard("needs_you").kind).toBe("overdue");
  });

  it("every registered tool exists, and every tool is registered", () => {
    for (const c of ASK_CARDS) expect(getAskCardTool(c.tool), c.tool).toBeDefined();
    expect(ASK_CARD_TOOLS.map((t) => t.name).sort()).toEqual(ASK_CARDS.map((c) => c.tool).sort());
  });

  it("card tools never write, approve, send, file, submit, pay, close or adopt", () => {
    for (const t of ASK_CARD_TOOLS) {
      expect(t.writes, t.name).toBe(false);
      expect(t.name).not.toMatch(FORBIDDEN);
    }
  });

  it("slice 2 can expose them by appending: no name collides with a model tool", () => {
    const chat = new Set(CHAT_TOOLS.map((t) => t.name));
    for (const t of ASK_CARD_TOOLS) expect(chat.has(t.name), t.name).toBe(false);
  });

  it("the model-facing tool list and system prompt are unchanged (the cassette key covers both)", () => {
    expect(CHAT_TOOLS.map((t) => t.name)).toEqual([
      "get_exposure",
      "list_stale_items",
      "explain_item",
      "upcoming_deadlines",
      "get_forecast",
      "get_audit_interest_exposure",
      "list_pending_approvals",
      "create_outreach_draft",
      "list_rules",
      "list_reports",
      "generate_report",
      "plan_close_out",
      "list_recoveries",
      "start_recovery_search",
      "list_agent_runs",
      "get_agent_run",
      "get_clock",
      "advance_clock",
      "open_view",
    ]);
    const defs = JSON.stringify(anthropicToolDefinitions());
    for (const t of ASK_CARD_TOOLS) expect(defs).not.toContain(`"${t.name}"`);
    expect(CHAT_SYSTEM_PROMPT).not.toMatch(/start_import|get_integrations|list_overdue|get_started/);
  });
});
