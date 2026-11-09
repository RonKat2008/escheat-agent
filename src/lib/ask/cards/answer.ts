/**
 * The one short sentence under an Ask action card. Built only from the card tool's own output (no model); it says what
 * the card lets the person do and never claims anything happened.
 */
import type { ExecutedTool } from "@/lib/chat/offline-answer";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const many = (n: number, one: string, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;

const SENTENCES: Readonly<Record<string, (d: Rec) => string>> = {
  start_import: (d) =>
    `Pick a ${d.kind === "clears" ? "bank-clears" : "check-register"} CSV on the card, check the column mapping and the row preview, then click Import. Nothing is stored until you do.`,
  get_integrations: (d) => {
    const rows = Array.isArray(d.integrations) ? d.integrations.map(rec) : [];
    const on = rows.filter((r) => r.state === "configured").length;
    return `${on} of ${rows.length} optional integrations are configured. Each row names the env vars that turn it on; nothing here connects to a real service.`;
  },
  list_overdue: (d) => {
    const overdue = num(rec(d.overdue).count);
    const waiting = num(d.approvalsWaiting);
    if (overdue === 0 && waiting === 0) return "Nothing is overdue and nothing is waiting for your approval.";
    return `${many(overdue, "item is", "items are")} past a deadline and ${many(waiting, "thing waits", "things wait")} for your approval. Each coral link opens the page where you act; nothing is approved from here.`;
  },
  get_started: (d) => {
    const steps = Array.isArray(d.steps) ? d.steps.map(rec) : [];
    const done = steps.filter((s) => s.done === true).length;
    const next = steps.find((s) => s.done !== true);
    return `${done} of ${steps.length} setup steps done.${next && typeof next.step === "string" ? ` Next: ${next.step.toLowerCase()}.` : " Setup is complete."}`;
  },
  review_approvals: (d) => {
    const waiting = num(d.waiting);
    if (waiting === 0) return "Nothing is waiting for approval.";
    const compose = num(d.toCompose);
    const split = compose > 0 ? ` ${num(d.readyToApprove)} can be approved now; ${compose} still ${compose === 1 ? "needs its letter" : "need their letters"} composed first (Compose on the row; it approves and sends nothing).` : "";
    return `${many(waiting, "approval waits", "approvals wait")} for a person.${split} Each row says exactly what the approval covers and what can happen after it; Approve records your consent through the same check as the Approvals page and sends or files nothing.`;
  },
  prepare_outreach: (d) => {
    const waiting = Array.isArray(d.waitingLetters) ? d.waitingLetters.length : 0;
    const can = Array.isArray(d.candidates) ? d.candidates.map(rec).filter((c) => c.canDraft === true).length : 0;
    const compose = num(d.toCompose);
    if (waiting === 0 && can === 0 && compose === 0) return "No letter waits for approval and nothing can be drafted right now.";
    const composeText = compose > 0 ? `, ${many(compose, "drafted letter")} still to compose` : "";
    return `${many(waiting, "letter is", "letters are")} ready to approve${composeText} and ${many(can, "more item")} can be drafted. Request approval composes the letter from the rule file's wording; nothing is mailed.`;
  },
  prepare_period_close: (d) => {
    const period = typeof d.period === "string" ? d.period : "This month";
    if (d.status === "closed") return `${period} is closed. Its frozen close pack downloads from the card.`;
    if (d.status !== "open") return `${period} has not started on the demo clock, so it cannot be closed yet.`;
    return `${period} is open. Check the tie-out, then type your name and approve the close on the card. Closing is irreversible; nothing is posted to an accounting system.`;
  },
  prepare_filing: (d) => {
    const state = typeof d.state === "string" ? d.state : "This state";
    const report = rec(d.report);
    if (!d.report) return `${state} has no report for this cycle yet. Generate it in Reports first.`;
    if (report.status === "approved") return `The ${state} report is approved. Filing runs only on the replica portal, from the close-out runner.`;
    if (report.status === "submitted" || report.status === "confirmed") return `The ${state} report is on the replica portal.`;
    return `The ${state} report waits for a person's approval. Approve it on the card, then file on the replica portal from the close-out runner.`;
  },
};

export function cardAnswerText(tools: readonly ExecutedTool[]): string {
  return tools
    .map((t) => (t.ok ? (SENTENCES[t.name]?.(rec(t.data)) ?? t.summary) : (t.error ?? t.summary)))
    .filter((s) => s.length > 0)
    .join("\n\n");
}
