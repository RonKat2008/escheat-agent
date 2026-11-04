import { recordedNextPrompts, recordedOnly } from "@/lib/chat/recorded-prompts";
import type { UiPayload } from "@/lib/chat/ui-types";

export const EXAMPLE_PROMPTS = [
  "What do we owe and where?",
  "What's due in the next 90 days?",
  "Explain check #10482",
  "Draft the due-diligence letter for #10087",
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

const MAX_RECOVERY_CHIPS = 6;

/** Recorded prompts that ask the same thing; only the first of each pair is offered (it opens the longer demo). */
const SAME_QUESTION: readonly (readonly [keep: string, drop: string])[] = [["What do we owe and where?", "What do we owe in unclaimed property, and where?"]];

const norm = (s: string): string => s.trim().toLowerCase();

export interface OfflineRecovery {
  /** Why these chips are shown: a missed question, or the end of a recorded conversation. */
  note: string;
  prompts: string[];
}

/**
 * Offline recovery (R4-26, R5-16): replay has nothing to continue this conversation with, so offer prompts that DO
 * have a recording as the first turn of a NEW chat. Every entry replays.
 *  - `missed`: the last question had no recording here. If it is recorded as a first question, it is offered first
 *    (replay is keyed on the whole conversation, so it only replays in a new chat).
 *  - otherwise the recorded conversation simply ended after a real answer: the note says so, not "only answers
 *    recorded questions".
 * Never offers a prompt already asked in this chat, nor two wordings of the same question.
 */
export function offlineRecovery(asked: readonly string[], missed: boolean): OfflineRecovery {
  const firstTurns = recordedNextPrompts([]);
  const last = asked.at(-1);
  const lastAsFirst = missed && last ? firstTurns.find((p) => norm(p) === norm(last)) : undefined;
  const dropped = new Set(SAME_QUESTION.filter(([keep]) => firstTurns.some((p) => norm(p) === norm(keep))).map(([, drop]) => norm(drop)));
  const prompts: string[] = [];
  const add = (p: string | undefined) => {
    if (!p || prompts.some((o) => norm(o) === norm(p))) return;
    prompts.push(p);
  };
  add(lastAsFirst);
  for (const p of firstTurns) {
    if (asked.some((a) => norm(a) === norm(p)) || dropped.has(norm(p))) continue;
    add(p);
  }
  const note = !missed
    ? "That is the end of this recorded conversation. Continue with a recorded question (starts a new chat):"
    : lastAsFirst
      ? "Offline replay answers a recorded question only where it was recorded. This one replays as the first question of a new chat:"
      : "Offline replay only answers recorded questions. Try one of these (starts a new chat):";
  return { note, prompts: prompts.slice(0, MAX_RECOVERY_CHIPS) };
}
