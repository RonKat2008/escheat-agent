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
};

export function cardAnswerText(tools: readonly ExecutedTool[]): string {
  return tools
    .map((t) => (t.ok ? (SENTENCES[t.name]?.(rec(t.data)) ?? t.summary) : (t.error ?? t.summary)))
    .filter((s) => s.length > 0)
    .join("\n\n");
}
