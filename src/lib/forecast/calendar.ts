/** Forecast -> iCalendar feed of filing deadlines (DD window openings, report and remit due dates). */
import { sha256Hex } from "@/lib/crypto";
import { DISCLAIMER } from "@/lib/disclaimer";
import { formatUSD } from "@/lib/money";
import { calendarDeadlines, type CalendarDeadline, type CalendarExtra, type Forecast } from "./compute";
import { icsDate, writeIcs, type IcsEvent } from "./ics";

const KIND_TITLE: Record<CalendarDeadline["kind"], string> = {
  dd_window_opens: "due-diligence window opens",
  report_due: "report due",
  remit_due: "remittance due",
};

export const UNVERIFIED_NOTE = "UNVERIFIED: this date depends on a rule value a human has not verified yet. Check it in Rules.";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Stable across requests: same company, kind, state, stage and date always give the same UID. */
export function deadlineUid(companyId: string, d: Pick<CalendarDeadline | CalendarExtra, "kind" | "state" | "stage" | "date">): string {
  const company = sha256Hex(companyId).slice(0, 12);
  const stage = (d.stage ?? "main").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${d.kind.replace(/_/g, "-")}-${d.state.toLowerCase()}-${stage}-${icsDate(d.date)}-${company}@escheat-agent`;
}

export function deadlineEvent(companyId: string, d: CalendarDeadline, baseUrl?: string): IcsEvent {
  const stage = d.kind === "report_due" && d.stage ? ` (${d.stage} stage)` : "";
  const summary = `${d.state} ${KIND_TITLE[d.kind]}${stage}: ${plural(d.count, "item")}, ${formatUSD(d.cents)}`;
  const description = [
    `${plural(d.count, "item")} totaling ${formatUSD(d.cents)} (synthetic demo data).`,
    "Date computed by the deterministic rules engine.",
    d.verified ? null : UNVERIFIED_NOTE,
    DISCLAIMER,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    uid: deadlineUid(companyId, d),
    date: d.date,
    summary: d.verified ? summary : `${summary} [unverified]`,
    description,
    categories: ["Unclaimed property", d.state],
    alarm: { trigger: REMINDER_TRIGGER, description: summary },
    ...(baseUrl ? { url: `${baseUrl.replace(/\/+$/, "")}/forecast?state=${d.state}` } : {}),
  };
}

/** Reminder lead time for upcoming deadlines (RFC 5545 DURATION before the all-day event's start). */
export const REMINDER_TRIGGER = "-P7D";

const EXTRA_TITLE: Record<CalendarExtra["kind"], string> = {
  dd_window_closes: "due-diligence window closes (send letters by this date)",
  overdue_dd_window_closes: "due-diligence window closed",
  overdue_report_due: "report was due",
  overdue_remit_due: "remittance was due",
};

export function extraEvent(companyId: string, x: CalendarExtra, baseUrl?: string): IcsEvent {
  const overdue = x.kind.startsWith("overdue_");
  const stage = x.kind === "overdue_report_due" && x.stage ? ` (${x.stage} stage)` : "";
  const core = `${x.state} ${EXTRA_TITLE[x.kind]}${stage}: ${plural(x.count, "item")}, ${formatUSD(x.cents)}`;
  const summary = `${overdue ? "OVERDUE: " : ""}${core}${x.verified ? "" : " [unverified]"}`;
  const description = [
    overdue ? "OVERDUE: this date has passed and the item is still open in the system." : null,
    `${plural(x.count, "item")} totaling ${formatUSD(x.cents)} (synthetic demo data).`,
    "Date computed by the deterministic rules engine.",
    x.verified ? null : UNVERIFIED_NOTE,
    DISCLAIMER,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    uid: deadlineUid(companyId, x),
    date: x.date,
    summary,
    description,
    categories: overdue ? ["Unclaimed property", x.state, "OVERDUE"] : ["Unclaimed property", x.state],
    alarm: { trigger: overdue ? "PT0S" : REMINDER_TRIGGER, description: summary },
    ...(baseUrl ? { url: `${baseUrl.replace(/\/+$/, "")}/forecast?state=${x.state}` } : {}),
  };
}

export function forecastToIcs(
  forecast: Forecast,
  opts: { companyId: string; companyName: string; baseUrl?: string; extras?: readonly CalendarExtra[] },
): string {
  return writeIcs({
    prodId: "-//Escheat Agent//Liability forecast//EN",
    name: `${opts.companyName}: unclaimed-property deadlines`,
    stamp: forecast.asOf,
    events: [
      ...calendarDeadlines(forecast).map((d) => deadlineEvent(opts.companyId, d, opts.baseUrl)),
      ...(opts.extras ?? []).map((x) => extraEvent(opts.companyId, x, opts.baseUrl)),
    ],
  });
}
