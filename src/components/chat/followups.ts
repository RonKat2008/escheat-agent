import { recordedOnly } from "@/lib/chat/recorded-prompts";
import type { UiPayload } from "@/lib/chat/ui-types";

export const EXAMPLE_PROMPTS = [
  "What do we owe and where?",
  "What's due in the next 90 days?",
  "Explain check #10482",
  "Draft the due-diligence letter for #10482",
  "Which rules are unverified?",
  "Generate the CA report",
] as const;

/** Guided close-out prompts (the plan_close_out tool), shown as their own row in the empty chat. */
export const CLOSE_OUT_PROMPTS = [
  { state: "CA", label: "Close out CA", prompt: "Close out California for this cycle" },
  { state: "DE", label: "Close out DE", prompt: "Close out Delaware for this cycle" },
  { state: "TX", label: "Close out TX", prompt: "Close out Texas for this cycle" },
] as const;

export const closeOutPrompt = (state: string): string =>
  CLOSE_OUT_PROMPTS.find((p) => p.state === state.toUpperCase())?.prompt ?? "Close out California for this cycle";

const MAX_CHIPS = 3;

/** The four starter prompts shown as large chips in the empty chat (the rest of EXAMPLE_PROMPTS sit below them). */
export const STARTER_PROMPTS = EXAMPLE_PROMPTS.slice(0, 4);

/**
 * Deterministic next steps derived from what the last answer actually showed. No model call: chips only
 * point at questions the tools can answer, and never at approving or sending.
 */
export function followUpsFor(views: UiPayload[], asked: string[], opts: { offline?: boolean } = {}): string[] {
  const out: string[] = [];
  const add = (q: string | null | undefined) => {
    if (!q) return;
    const seen = asked.some((a) => a.trim().toLowerCase() === q.toLowerCase());
    if (!seen && !out.includes(q)) out.push(q);
  };

  for (const ui of views) {
    switch (ui.kind) {
      case "exposure": {
        const top = [...ui.props.exposure.byState].sort((a, b) => b.cents - a.cents)[0];
        add(top ? `Show the open ${top.state} items` : null);
        add("What's due in the next 90 days?");
        if (ui.props.exposure.anyUnverified) add("Which rules are unverified?");
        break;
      }
      case "items": {
        const first = ui.props.items.find((i) => i.checkNumber);
        add(first ? `Explain check #${first.checkNumber}` : null);
        add("What's due in the next 90 days?");
        break;
      }
      case "item_timeline": {
        const check = ui.props.explanation.item.checkNumber;
        add(check ? `Draft the due-diligence letter for #${check}` : null);
        add("Which rules are unverified?");
        break;
      }
      case "deadlines": {
        const first = ui.props.events.find((e) => e.checkNumber);
        add(first ? `Explain check #${first.checkNumber}` : null);
        add("What's waiting for approval?");
        break;
      }
      case "approval_card":
        add("What's waiting for approval?");
        add(ui.props.checkNumber ? `Explain check #${ui.props.checkNumber}` : null);
        break;
      case "rules":
        add("What do we owe and where?");
        add("Generate the CA report");
        break;
      case "report":
        add(closeOutPrompt(ui.props.state));
        add("Which rules are unverified?");
        add("What's waiting for approval?");
        break;
      case "reports":
        add("Which rules are unverified?");
        add("What's waiting for approval?");
        break;
      case "approvals":
        add("What's due in the next 90 days?");
        break;
      case "close_plan": {
        const left = ui.props.plan.total - ui.props.plan.done;
        add(left > 0 ? `What's left to close out ${ui.props.plan.state}?` : null);
        add("What's waiting for approval?");
        break;
      }
      case "recoveries":
      case "agent_run":
      case "runs":
        add("Show recent agent runs");
        break;
      default:
        break;
    }
  }
  // Offline replay can only answer prompts that were recorded at this point in the conversation (F36).
  if (opts.offline) return recordedOnly(out, asked, MAX_CHIPS);
  if (out.length === 0) {
    for (const q of EXAMPLE_PROMPTS) add(q);
  }
  return out.slice(0, MAX_CHIPS);
}
