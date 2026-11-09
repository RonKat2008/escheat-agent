/**
 * Offline answer text (dogfood R6-03). When offline replay cannot answer but the question's tools ran live, chat shows
 * the tool cards plus a short sentence built ONLY from those tools' output. No model writes it and the template never
 * decides law: every date, amount, status and UNVERIFIED flag is copied from the tool result, which comes from the rules
 * engine and the records. A tool the template does not know falls back to its own one-line summary.
 */
import { DEADLINE_LABEL, formatDate, plural } from "@/lib/format";

export const OFFLINE_ANSWER_LABEL = "Offline: answered directly from your data; no model was used.";

/** `card`: an Ask action card matched a deterministic intent (src/lib/ask/cards/intent.ts), so no model was asked at all. */
export type OfflineAnswerReason = "data_changed" | "not_recorded" | "card";

export const CARD_ANSWER_LABEL = "Answered directly from your data; no model was used.";

/** One tool that ran during the turn, as the agent loop saw it. */
export interface ExecutedTool {
  name: string;
  ok: boolean;
  summary: string;
  /** The tool's model payload (`data`), or undefined when it failed. */
  data?: unknown;
  /** The user-facing error (a refusal carries the reason and the rule-engine date). */
  error?: string;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const arr = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec) : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const asOf = (d: Rec): string => (str(d.asOf) ? ` As of ${formatDate(str(d.asOf))}.` : "");

function exposure(d: Rec): string {
  const total = str(d.total);
  const count = num(d.itemCount);
  if (!total || count === null) return "";
  const nc = rec(d.notCovered);
  const ncCount = num(nc.count) ?? 0;
  const ncStates = new Set(arr(nc.byState).map((s) => str(s.state)));
  const states = arr(d.byState)
    .filter((s) => str(s.state) && str(s.total) && !ncStates.has(str(s.state)))
    .map((s) => `${s.state} ${s.total}${num(s.count) !== null ? ` (${plural(num(s.count)!, "item")})` : ""}`);
  const where = states.length ? ` By state${ncCount > 0 ? " (rules loaded)" : ""}: ${states.join(", ")}.` : "";
  // R9-03: money owed in states with no rules file is in the total but has no dates; say so, never imply any.
  const notCovered =
    ncCount > 0
      ? ` Not covered yet: ${arr(nc.byState).map((s) => str(s.state)).filter(Boolean).join(", ")} · ${plural(ncCount, "item")} · ${str(nc.total)}. ${str(nc.note) ?? ""}`.trimEnd()
      : "";
  const flag = d.anyUnverified === true ? " Some of these figures rest on UNVERIFIED rule values." : "";
  return `${asOf(d).trim()} You have **${total}** across ${plural(count, "open stale item")}.${where}${notCovered}${flag}`.trim();
}

function deadlines(d: Rec): string {
  const count = num(d.count);
  const days = num(d.days);
  if (count === null || days === null) return "";
  if (count === 0) return `${asOf(d).trim()} Nothing falls due in the next ${days} days.`.trim();
  const events = arr(d.events);
  const first = events[0];
  const unverified = num(d.unverifiedCount) ?? 0;
  const next = first
    ? ` The first is ${DEADLINE_LABEL[str(first.kind) ?? ""] ?? str(first.kind)} on **${formatDate(str(first.date))}**${first.verified === false ? " (UNVERIFIED)" : ""}${
        str(first.check) ? ` for check #${first.check}` : ""
      }${str(first.payee) ? ` (${first.payee}${str(first.state) ? `, ${first.state}` : ""}${str(first.amount) ? `, ${first.amount}` : ""})` : ""}.`
    : "";
  const flag = unverified ? ` ${unverified === count ? (count === 1 ? "It rests" : "All of them rest") : `${unverified} of them rest`} on UNVERIFIED rule values.` : "";
  return `${asOf(d).trim()} **${plural(count, "deadline")}** in the next ${days} days.${next}${flag}`.trim();
}

function explain(d: Rec): string {
  const item = rec(d.item);
  const amount = str(item.amount);
  const payee = str(item.payee);
  if (!amount || !payee) return "";
  const check = str(item.check);
  const head = `${check ? `Check #${check}` : "This item"} is **${amount}** to ${payee}${str(item.ownerState) ? `, owed under ${item.ownerState} rules` : ""}`;
  const age = num(item.ageDays) !== null ? `, ${num(item.ageDays)} days old` : "";
  const status = str(item.status) ? `, status ${String(item.status).replace(/_/g, " ")}` : "";
  const today = str(d.asOf);
  const upcoming = arr(d.timeline).find((t) => str(t.date) && (!today || String(t.date) >= today));
  const next = upcoming
    ? ` Next on its timeline: ${str(upcoming.event) ?? "a deadline"} on **${formatDate(str(upcoming.date))}**${upcoming.flag ? ` (${upcoming.flag})` : ""}.`
    : "";
  const unknown = arr(d.timeline).some((t) => t.flag === "UNKNOWN") ? " At least one date is UNKNOWN because a rule value is missing." : "";
  return `${head}${age}${status}.${next}${unknown}`;
}

function rules(d: Rec): string {
  const states = arr(d.states).filter((s) => str(s.state));
  if (!states.length) return "";
  const parts = states.map((s) => {
    const v = num(s.verified) ?? 0;
    const u = num(s.unverified) ?? 0;
    return `${s.state} ${v} of ${v + u} verified`;
  });
  const unverified = states.reduce((n, s) => n + (num(s.unverified) ?? 0), 0);
  return `${parts.join(", ")}. ${unverified ? `${plural(unverified, "rule value")} ${unverified === 1 ? "is" : "are"} still UNVERIFIED; ` : ""}only a person can verify them, at Rules.`;
}

function draft(d: Rec): string {
  const owner = str(d.owner);
  const amount = str(d.amount);
  if (!owner || !amount) return "";
  const channel = str(d.channel) ?? "letter";
  const approved = d.status === "approved";
  const verb = approved ? `The ${channel} for ${owner} (${amount}) was already approved by a person` : `${d.created === true ? "Drafted" : "Opened the existing draft of"} the ${channel} for ${owner} (**${amount}**)`;
  const problems = Array.isArray(d.problems) ? d.problems.length : 0;
  const ready = d.ready === false ? ` It is not ready to send yet${problems ? ` (${plural(problems, "problem")} to fix)` : ""}.` : "";
  return `${verb}. Nothing was sent.${approved ? "" : " It waits for a person to approve it in Approvals."}${ready}`;
}

function report(d: Rec): string {
  if (d.regenerated === false) return str(d.reason) ?? "";
  const state = str(d.state);
  const items = num(d.items);
  const total = str(d.total);
  if (!state || items === null || !total) return "";
  const errors = num(d.errorCount) ?? 0;
  const warnings = num(d.warningCount) ?? 0;
  return `Generated and validated the ${state} report: ${plural(items, "item")}, **${total}**, ${plural(errors, "error")} and ${plural(warnings, "warning")}. Nothing was filed; filing needs a person's approval in the app.`;
}

function closeOut(d: Rec): string {
  const state = str(d.state);
  const done = num(d.done);
  const total = num(d.total);
  if (!state || done === null || total === null) return "";
  const notNeeded = num(d.notNeeded) ?? 0;
  const skip = notNeeded ? ` · ${notNeeded} not needed this cycle` : "";
  const stake = str(d.atStake) ? ` **${d.atStake}** at stake on ${plural(num(d.items) ?? 0, "item")}.` : "";
  // R7-02: the runner's headline deadline (report, else remittance); older outputs only carry reportDue.
  const nextDue = str(d.nextDue) ? /^(Report due|Remit due) (.*)$/.exec(String(d.nextDue)) : null;
  const due = nextDue ? ` ${nextDue[1]} ${formatDueText(nextDue[2]!)}.` : "nextDue" in d ? "" : str(d.reportDue) ? ` Report due ${formatDueText(String(d.reportDue))}.` : "";
  const next = rec(d.next);
  const nextText = str(next.step) ? ` Next: ${next.step}.` : "";
  return `${state} close-out: **${done} of ${total} steps done**${skip}.${stake}${due}${nextText}`;
}

/** "2026-11-02 (UNVERIFIED)" -> "Nov 2, 2026 (UNVERIFIED)"; UNKNOWN stays UNKNOWN. */
function formatDueText(raw: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})(.*)$/.exec(raw);
  return m ? `${formatDate(m[1])}${m[2]}` : raw;
}

const TEMPLATES: Readonly<Record<string, (d: Rec) => string>> = {
  get_exposure: exposure,
  upcoming_deadlines: deadlines,
  explain_item: explain,
  list_rules: rules,
  create_outreach_draft: draft,
  generate_report: report,
  plan_close_out: closeOut,
};

/** One sentence per tool, from that tool's own output. */
export function sentenceFor(tool: ExecutedTool): string {
  if (!tool.ok) return tool.error ?? tool.summary;
  const template = TEMPLATES[tool.name];
  const text = template ? template(rec(tool.data)) : "";
  if (text) return text;
  const s = tool.summary.trim();
  return s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}.` : "";
}

/** The whole answer text: one paragraph per tool that ran. */
export function offlineAnswerText(tools: readonly ExecutedTool[]): string {
  return tools
    .map(sentenceFor)
    .filter((s) => s.length > 0)
    .join("\n\n");
}
