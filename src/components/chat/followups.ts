import type { UiPayload } from "@/lib/chat/ui-types";

export const EXAMPLE_PROMPTS = [
  "What do we owe and where?",
  "What's due in the next 90 days?",
  "Explain check #10482",
  "Draft the due-diligence letter for #10482",
  "Which rules are unverified?",
  "Generate the CA report",
] as const;

const MAX_CHIPS = 3;

/**
 * Deterministic next steps derived from what the last answer actually showed. No model call: chips only
 * point at questions the tools can answer, and never at approving or sending.
 */
export function followUpsFor(views: UiPayload[], asked: string[]): string[] {
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
      case "reports":
      case "report":
        add("Which rules are unverified?");
        add("What's waiting for approval?");
        break;
      case "approvals":
        add("What's due in the next 90 days?");
        break;
      case "recoveries":
      case "agent_run":
      case "runs":
        add("Show recent agent runs");
        break;
      default:
        break;
    }
  }
  if (out.length === 0) {
    for (const q of EXAMPLE_PROMPTS) add(q);
  }
  return out.slice(0, MAX_CHIPS);
}
