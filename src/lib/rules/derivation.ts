/**
 * Plain-English rendering of the rules engine's structured derivation (F14, F15, F27). Pure and deterministic:
 * every date and number comes from the engine's Derivation; nothing is recomputed or guessed here.
 */
import { formatDate } from "@/lib/format";
import type { Derivation, DerivationStep, RollInfo } from "./engine";
import { fieldMeta, PT_LABEL } from "./labels";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The schema default for companies.fiscal_year_end; said out loud because nobody may have set it. */
const DEFAULT_FYE = "12-31";

const fmt = (iso: string) => formatDate(iso);
const monthDay = (month: number, day: number) => `${MONTHS[month - 1] ?? month} ${day}`;
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

const CLOCK_LABEL: Record<string, string> = {
  issue_date: "Issued",
  last_owner_activity: "Last owner activity",
  payable_date: "Payable",
};
const CLOCK_WORDS: Record<string, string> = {
  issue_date: "issue",
  last_owner_activity: "last owner activity",
  payable_date: "payable",
};

function dormancyText(years: number, months: number): string {
  return Number.isInteger(years) ? `${years}-year dormancy` : `${months}-month dormancy`;
}

function yearOf(asOfYear: number, yearOffset: number): string {
  if (yearOffset === 0) return `the as-of year (${asOfYear})`;
  if (yearOffset === 1) return `the year after the as-of year (${asOfYear + 1})`;
  return `${yearOffset} years after the as-of year (${asOfYear + yearOffset})`;
}

function fyeText(fye: string | undefined): string {
  if (!fye) return "the holder's fiscal year end";
  const [m, d] = fye.split("-").map(Number);
  const md = monthDay(m!, d!);
  return fye === DEFAULT_FYE
    ? `the holder's fiscal year end (${md}, from company settings; ${md} is also the default when none was entered)`
    : `the holder's fiscal year end (${md}, from company settings)`;
}

function stepText(s: DerivationStep, next: DerivationStep | undefined): string | null {
  switch (s.kind) {
    case "clock_start": {
      if (next?.kind === "dormancy") {
        const formula = `${fmt(s.date)} + ${dormancyText(next.years, next.months)} = ${fmt(next.result)}`;
        return s.fallback
          ? `The dormancy clock starts on the ${CLOCK_WORDS[s.basis] ?? s.basis} date; none on file, so the last-activity date is used: ${formula}.`
          : `${CLOCK_LABEL[s.basis] ?? s.basis} ${formula}.`;
      }
      return `Dormancy clock starts ${fmt(s.date)}.`;
    }
    case "dormancy":
      return null; // folded into clock_start
    case "presumed_ref":
      return `Presumed abandoned ${fmt(s.date)}.`;
    case "as_of":
      return s.basis === "fiscal_year_end"
        ? `The as-of date is ${fyeText(s.fiscalYearEnd)}: the first one on or after ${fmt(s.from)} is ${fmt(s.result)}.`
        : `The report covers property presumed abandoned by the ${monthDay(s.month, s.day)} cutoff: the first ${monthDay(s.month, s.day)} on or after ${fmt(s.from)} is ${fmt(s.result)} (as-of date).`;
    case "fixed_date": {
      const base = `Due ${monthDay(s.month, s.day)} of ${yearOf(s.asOfYear, s.yearOffset)}`;
      if (!s.movedPast) return `${base} = ${fmt(s.result)}.`;
      const what = s.movedPast.what === "as_of" ? `the as-of date ${fmt(s.movedPast.date)}` : `the ${s.movedPast.stage} stage's due date ${fmt(s.movedPast.date)}`;
      return `${base} would be ${fmt(s.candidate)}, which is on or before ${what}, so it moves to the next ${monthDay(s.month, s.day)}: ${fmt(s.result)}.`;
    }
    case "stage_ref":
      return `The ${s.stage} stage is due ${fmt(s.date)}.`;
    case "after_stage":
      return `${fmt(s.from)} + ${s.months} months = ${fmt(s.result)}.`;
    case "after_stage_days":
      return `${fmt(s.from)} + ${s.days} days = ${fmt(s.result)}.`;
    case "with_report":
      return `Remittance is due with the ${s.stage} report:`;
    case "remit_fixed":
      return `Remittance is due ${monthDay(s.month, s.day)} of ${yearOf(s.asOfYear, s.yearOffset)} = ${fmt(s.result)}.`;
    case "window_before":
      return `The window ${s.edge} ${s.days} days before the first report is due: report due (${s.stage}) ${fmt(s.reportDue)} − ${s.days} days = ${fmt(s.result)}.`;
    case "window_at_presumed":
      return `The statute sets no earliest notice date, so the window opens at presumed abandonment, ${fmt(s.date)}.`;
  }
}

/**
 * One plain-English sentence per derivation step, in order. The roll-forward (if any) is the last line unless
 * `includeRoll` is false (the UI shows it separately so it stands out).
 */
export function describeDerivation(d: Derivation, opts: { includeRoll?: boolean } = {}): string[] {
  const lines = d.steps.map((s, i) => stepText(s, d.steps[i + 1])).filter((l): l is string => l !== null);
  if (d.roll && opts.includeRoll !== false) lines.push(describeRoll(d.roll));
  return lines;
}

/** "Jun 15, 2030 is a Saturday, so it rolled forward to Monday, Jun 17, 2030 (rule: ...)." plus the counsel flag. */
export function describeRoll(r: RollInfo): string {
  const why = r.holiday ? `is a holiday (${WEEKDAYS[r.fromWeekday]})` : `is a ${WEEKDAYS[r.fromWeekday]}`;
  const toDay = WEEKDAYS[new Date(`${r.to}T00:00:00Z`).getUTCDay()];
  const rule = `${fieldMeta(r.path).label}${r.verified ? "" : ", unverified"}`;
  return (
    `${fmt(r.from)} ${why}, so it rolled forward to ${toDay}, ${fmt(r.to)} (rule: ${rule}). ` +
    "The direction comes from the rule file, not from this app; if the statute says the date must be met \"before\" or " +
    "\"on or before\" a day, counsel should confirm whether a weekend deadline moves forward or back."
  );
}

/** "Vendor check: dormancy period", "Report stage notice: report due", "Roll weekend/holiday deadlines forward". */
export function ruleFieldLabel(path: string): string {
  const m = fieldMeta(path);
  const pt = /^propertyTypes\.(\w+)\./.exec(path);
  if (pt) return `${PT_LABEL[pt[1]!] ?? pt[1]}: ${lc(m.label)}`;
  if (path.startsWith("dueDiligence.")) return `Due diligence: ${lc(m.label)}`;
  const st = /^reportStages\[(.+)\]\./.exec(path);
  if (st) return `Report stage ${st[1]}: ${lc(m.label)}`;
  return m.label;
}
