/**
 * Deterministic rules engine. Code computes every legal date; nothing here ever consults a model.
 *
 * Contract:
 *  - Every output date is a DatedValue { date, status, verified, ruleRefs, sources, notes }.
 *  - A rule input whose value is null makes every output that depends on it `unknown` (date = null).
 *  - `verified` of an output = AND of the `verified` flag of every RuleValue it depended on
 *    (including those of earlier stages it chains from, and the dormancy rules that fix its as-of year).
 *  - Outputs record which rule file version produced them (ruleRefs[].version, Timeline.rules).
 *
 * Semantics (documented choices where statutes vary):
 *  - presumedAbandoned = clock-start date + dormancyYears (calendar months, Feb 29 + 1y = Feb 28).
 *    The clock-start date is `clockDates[clockStartsFrom]` when supplied, else `lastActivityDate`.
 *  - A stage's as-of date (fixed_cutoff / fiscal_year_end) is the first occurrence of the cutoff that is
 *    on or after presumedAbandoned (a property presumed abandoned exactly ON the cutoff is included in
 *    that year; one day after the cutoff rolls to the next year).
 *  - fixed_date due dates land in (as-of year + yearOffset). after_stage / after_stage_days chain from the
 *    referenced stage's unrolled statutory due date; business-day roll is applied last to each output.
 *  - Roll: businessDayRollForward true => weekend/holiday dates move to the next business day;
 *    false => none; null => none, but the output is marked unverified with a note.
 *  - DD window = [firstStageDue - window.max, firstStageDue - window.min] (rolled due date).
 *  - remit fixed_date uses the first report stage's as-of year.
 */

import {
  addDays,
  addMonths,
  compare,
  dayOfWeek,
  diffDays,
  fromYMD,
  isWeekend,
  nextBusinessDay,
  toYMD,
  type IsoDate,
} from "../dates";
import type {
  ClockStartsFrom,
  RuleFile,
  RulePropertyType,
  RuleSource,
  RuleValue,
  ReportStageRule,
} from "../../../rules/schema";
import { mulRateCents } from "../money";

export interface RuleRef {
  state: string;
  version: string;
  path: string;
}

export type DateStatus = "ok" | "unknown" | "not_applicable";

/**
 * How a date was computed, step by step, from the engine's actual inputs (F14). Structured so the UI and chat can
 * render it in plain English (see derivation.ts) without re-deriving anything. Every number here is the one the
 * engine used; nothing is recomputed for display.
 */
export type DerivationStep =
  /** Dormancy clock start. `fallback`: the rule names a date the caller did not supply, so lastActivityDate was used. */
  | { kind: "clock_start"; date: IsoDate; basis: ClockStartsFrom; fallback: boolean }
  /** start + dormancy (whole months) = presumed abandoned. */
  | { kind: "dormancy"; from: IsoDate; years: number; months: number; result: IsoDate; path: string }
  /** A chained step starts from the presumed-abandoned date. */
  | { kind: "presumed_ref"; date: IsoDate }
  /** As-of date: first month/day on or after `from`. fiscalYearEnd ("MM-DD") is set for fiscal_year_end rules. */
  | {
      kind: "as_of";
      from: IsoDate;
      month: number;
      day: number;
      result: IsoDate;
      basis: "fixed_cutoff" | "fiscal_year_end";
      fiscalYearEnd?: string;
      path: string;
    }
  /**
   * Fixed due date: month/day in (as-of year + yearOffset). `movedPast` is set when that first candidate fell on/before
   * the as-of date or the preceding stage's due date and the date moved to the next later occurrence.
   */
  | {
      kind: "fixed_date";
      stage: string;
      month: number;
      day: number;
      yearOffset: number;
      asOfYear: number;
      candidate: IsoDate;
      result: IsoDate;
      movedPast: { what: "as_of"; date: IsoDate } | { what: "prev_stage"; stage: string; date: IsoDate } | null;
      path: string;
    }
  /** A chained step starts from another stage's (unrolled) statutory due date. */
  | { kind: "stage_ref"; stage: string; date: IsoDate }
  | { kind: "after_stage"; stage: string; from: IsoDate; months: number; result: IsoDate; path: string }
  | { kind: "after_stage_days"; stage: string; from: IsoDate; days: number; result: IsoDate; path: string }
  /** Remittance is due with a named report stage; the steps that follow are that stage's. */
  | { kind: "with_report"; stage: string; path: string }
  /** Remittance on a fixed date in (first stage's as-of year + yearOffset). */
  | { kind: "remit_fixed"; month: number; day: number; yearOffset: number; asOfYear: number; result: IsoDate; path: string }
  /** Due-diligence window edge = first report's (rolled) due date minus N days. */
  | { kind: "window_before"; edge: "opens" | "closes"; stage: string; reportDue: IsoDate; days: number; result: IsoDate; path: string }
  /** No statutory earliest date: the window opens when the property is presumed abandoned. */
  | { kind: "window_at_presumed"; date: IsoDate; path: string };

/** A weekend/holiday date moved by the business-day roll-forward rule. */
export interface RollInfo {
  from: IsoDate;
  to: IsoDate;
  /** 0 = Sunday ... 6 = Saturday, of `from`. */
  fromWeekday: number;
  /** true when `from` was a weekday listed as a holiday. */
  holiday: boolean;
  path: "businessDayRollForward";
  /** Whether the roll rule itself has been verified by a person. */
  verified: boolean;
}

export interface Derivation {
  steps: DerivationStep[];
  /** Set when the roll-forward changed the date. */
  roll: RollInfo | null;
}

export interface DatedValue {
  /** null when status is unknown or not_applicable. */
  date: IsoDate | null;
  status: DateStatus;
  /** true only when status is not unknown and every contributing RuleValue is verified. */
  verified: boolean;
  ruleRefs: RuleRef[];
  sources: RuleSource[];
  notes: string[];
  /** How the date was computed (status ok only; null otherwise). Optional for hand-built values in tests. */
  derivation?: Derivation | null;
}

export interface TimelineInput {
  propertyType: RulePropertyType;
  /** Last owner activity / clock start supplied by the caller (see clockDates). */
  lastActivityDate: IsoDate;
  amountCents: number;
  ownerState: string;
  /** Specific clock-start dates; the one named by the rule's clockStartsFrom wins over lastActivityDate. */
  clockDates?: Partial<Record<ClockStartsFrom, IsoDate>>;
  /** Holder fiscal year end as "MM-DD" (company fiscal_year_end), needed only for `fiscal_year_end` as-of rules. */
  holderFiscalYearEnd?: string;
}

export interface EngineOptions {
  /** Extra non-business days (YYYY-MM-DD) honoured by the roll-forward. */
  holidays?: readonly string[];
}

export interface StageTimeline {
  name: string;
  asOf: DatedValue;
  due: DatedValue;
  includesRemittance: boolean;
}

export interface Timeline {
  state: string;
  propertyType: RulePropertyType;
  rules: { state: string; version: string };
  presumedAbandoned: DatedValue;
  /** Whether due diligence applies to this item (null = unknown). */
  ddApplies: boolean | null;
  ddWindow: { start: DatedValue; end: DatedValue };
  reportStages: StageTimeline[];
  remitDue: DatedValue;
  /** amount < state's per-item minimum reportable amount (null = rule unknown). */
  minAmountApplies: boolean | null;
  /** amount < aggregate-reporting threshold, i.e. may be reported in aggregate (null = rule unknown). */
  aggregate: boolean | null;
  anyUnverified: boolean;
  anyUnknown: boolean;
  warnings: string[];
}

interface Dep {
  path: string;
  rv: RuleValue<unknown>;
}

const uniqSources = (deps: Dep[]): RuleSource[] => {
  const seen = new Set<string>();
  const out: RuleSource[] = [];
  for (const d of deps)
    for (const s of d.rv.sources) {
      const k = `${s.url}\u0000${s.quote}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(s);
      }
    }
  return out;
};

function mk(
  rules: RuleFile,
  date: IsoDate | null,
  status: DateStatus,
  deps: Dep[],
  notes: string[] = [],
  derivation: Derivation | null = null,
): DatedValue {
  const uniqDeps = [...new Map(deps.map((d) => [d.path, d])).values()];
  return {
    date: status === "ok" ? date : null,
    status,
    verified: status !== "unknown" && uniqDeps.every((d) => d.rv.verified),
    ruleRefs: uniqDeps.map((d) => ({ state: rules.state, version: rules.version, path: d.path })),
    sources: uniqSources(uniqDeps),
    notes,
    derivation: status === "ok" ? derivation : null,
  };
}

const unknown = (rules: RuleFile, deps: Dep[], note: string) => mk(rules, null, "unknown", deps, [note]);

interface Internal {
  notes: string[];
  value: DatedValue;
  deps: Dep[];
  /** Unrolled statutory date (used for chaining). */
  base: IsoDate | null;
  asOfYear: number | null;
  /** Derivation steps up to `base` (before any roll). */
  steps: DerivationStep[];
}

const dep = (path: string, rv: RuleValue<unknown>): Dep => ({ path, rv });

function parseMMDD(v: string | undefined): { month: number; day: number } | null {
  const m = v ? /^(\d{2})-(\d{2})$/.exec(v) : null;
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { month, day } : null;
}

/** First occurrence of month/day on or after `from`. */
function firstOnOrAfter(from: IsoDate, month: number, day: number): IsoDate {
  const { y } = toYMD(from);
  const cand = fromYMD(y, month, day);
  return compare(cand, from) >= 0 ? cand : fromYMD(y + 1, month, day);
}

export function computeTimeline(input: TimelineInput, rules: RuleFile, options: EngineOptions = {}): Timeline {
  const warnings: string[] = [];
  const pt = rules.propertyTypes[input.propertyType];
  const holidays = options.holidays ?? [];
  const rollRv = rules.businessDayRollForward;
  const rollDep = dep("businessDayRollForward", rollRv);

  const allUnknown = (why: string): Timeline => {
    const u = () => unknown(rules, [], why);
    return finish({
      state: rules.state,
      propertyType: input.propertyType,
      rules: { state: rules.state, version: rules.version },
      presumedAbandoned: u(),
      ddApplies: null,
      ddWindow: { start: u(), end: u() },
      reportStages: rules.reportStages.map((s) => ({ name: s.name, asOf: u(), due: u(), includesRemittance: s.includesRemittance })),
      remitDue: u(),
      minAmountApplies: null,
      aggregate: null,
      warnings: [why],
    });
  };

  if (input.ownerState !== rules.state) {
    return allUnknown(`Rule file is for ${rules.state} but owner state is ${input.ownerState}`);
  }
  if (!pt) return allUnknown(`No ${input.propertyType} rule in ${rules.state}@${rules.version}`);

  /* ---- presumed abandoned */
  const base = `propertyTypes.${input.propertyType}`;
  const dDorm = dep(`${base}.dormancyYears`, pt.dormancyYears);
  const dClock = dep(`${base}.clockStartsFrom`, pt.clockStartsFrom);
  let presumed: DatedValue;
  if (pt.dormancyYears.value === null || pt.clockStartsFrom.value === null) {
    presumed = unknown(rules, [dDorm, dClock], "Dormancy period or clock start is unknown in the rule file");
  } else {
    const csf = pt.clockStartsFrom.value;
    const specific = input.clockDates?.[csf];
    const start = specific ?? input.lastActivityDate;
    const notes = specific ? [] : [`Clock starts from ${csf}; using the supplied last-activity date`];
    const months = Math.round(pt.dormancyYears.value * 12);
    const result = addMonths(start, months);
    presumed = mk(rules, result, "ok", [dDorm, dClock], notes, {
      steps: [
        { kind: "clock_start", date: start, basis: csf, fallback: !specific },
        { kind: "dormancy", from: start, years: pt.dormancyYears.value, months, result, path: dDorm.path },
      ],
      roll: null,
    });
  }
  const presumedDeps: Dep[] = [dDorm, dClock];

  /* ---- stages */
  const byName = new Map(rules.reportStages.map((s) => [s.name, s] as const));
  const memo = new Map<string, Internal>();
  const visiting = new Set<string>();

  const resolveStage = (st: ReportStageRule): Internal => {
    const cached = memo.get(st.name);
    if (cached) return cached;
    const asOfPath = `reportStages[${st.name}].asOfRule`;
    const duePath = `reportStages[${st.name}].dueRule`;
    const fail = (deps: Dep[], note: string): Internal => ({
      value: unknown(rules, deps, note),
      deps,
      base: null,
      asOfYear: null,
      notes: [],
      steps: [],
    });

    if (visiting.has(st.name)) return fail([dep(duePath, st.dueRule)], `Circular stage reference at ${st.name}`);
    visiting.add(st.name);
    let result: Internal;

    const dueRv = st.dueRule.value;
    const dDue = dep(duePath, st.dueRule);
    if (presumed.status !== "ok" || presumed.date === null) {
      result = fail([dDue, ...presumedDeps], "Presumed-abandoned date is unknown");
    } else if (dueRv === null) {
      result = fail([dDue], `Due rule for stage ${st.name} is unknown`);
    } else if (dueRv.type === "fixed_date") {
      const as = asOfFor(st);
      const idx = rules.reportStages.indexOf(st);
      const prevStage = idx > 0 ? rules.reportStages[idx - 1]! : null;
      const prev = prevStage ? resolveStage(prevStage) : null;
      if (as.date === null) {
        result = fail([dDue, ...as.deps, ...presumedDeps], as.note);
      } else if (prev && prev.base === null) {
        result = fail([dDue, ...as.deps, ...prev.deps], `Preceding stage ${prevStage!.name} is unknown`);
      } else {
        const asY = toYMD(as.date).y;
        // A stage is never due on/before its own as-of date or on/before the preceding stage's due date:
        // the file's yearOffset is the minimum, and the date moves to the first later occurrence of month/day.
        const floor = prev?.base && compare(prev.base, as.date) > 0 ? prev.base : as.date;
        let y = asY + dueRv.yearOffset;
        let due = fromYMD(y, dueRv.month, dueRv.day);
        const notes: string[] = [];
        while (compare(due, floor) <= 0) {
          y++;
          due = fromYMD(y, dueRv.month, dueRv.day);
        }
        const candidate = fromYMD(asY + dueRv.yearOffset, dueRv.month, dueRv.day);
        let movedPast: Extract<DerivationStep, { kind: "fixed_date" }>["movedPast"] = null;
        if (y !== asY + dueRv.yearOffset) {
          notes.push(`Due ${dueRv.month}/${dueRv.day} moved to ${y}: a stage is due after its as-of date and the preceding stage`);
          movedPast = floor === as.date ? { what: "as_of", date: as.date } : { what: "prev_stage", stage: prevStage!.name, date: floor };
        }
        result = {
          value: mk(rules, due, "ok", []),
          deps: [dDue, ...as.deps, ...presumedDeps, ...(prev?.deps ?? [])],
          base: due,
          asOfYear: asY,
          notes,
          steps: [
            { kind: "presumed_ref", date: presumed.date },
            ...as.steps,
            {
              kind: "fixed_date",
              stage: st.name,
              month: dueRv.month,
              day: dueRv.day,
              yearOffset: dueRv.yearOffset,
              asOfYear: asY,
              candidate,
              result: due,
              movedPast,
              path: duePath,
            },
          ],
        };
      }
    } else {
      const refStage = byName.get(dueRv.stage);
      if (!refStage) {
        result = fail([dDue], `Stage ${st.name} references unknown stage ${dueRv.stage}`);
      } else {
        const ref = resolveStage(refStage);
        if (ref.base === null) {
          result = fail([dDue, ...ref.deps], `Stage ${dueRv.stage} (referenced by ${st.name}) is unknown`);
        } else {
          const due = dueRv.type === "after_stage" ? addMonths(ref.base, dueRv.months) : addDays(ref.base, dueRv.days);
          const step: DerivationStep =
            dueRv.type === "after_stage"
              ? { kind: "after_stage", stage: dueRv.stage, from: ref.base, months: dueRv.months, result: due, path: duePath }
              : { kind: "after_stage_days", stage: dueRv.stage, from: ref.base, days: dueRv.days, result: due, path: duePath };
          result = {
            value: mk(rules, due, "ok", []),
            deps: [dDue, ...ref.deps],
            base: due,
            asOfYear: ref.asOfYear,
            notes: [],
            steps: [{ kind: "stage_ref", stage: dueRv.stage, date: ref.base }, step],
          };
        }
      }
    }
    visiting.delete(st.name);
    memo.set(st.name, result);
    return result;

    function asOfFor(s: ReportStageRule): { date: IsoDate | null; deps: Dep[]; note: string; steps: DerivationStep[] } {
      const d = dep(asOfPath, s.asOfRule);
      const a = asOfDate(s, presumed.date!);
      return a ? { date: a.date, deps: [d], note: "", steps: [a.step] } : { date: null, deps: [d], note: asOfUnknownNote(s), steps: [] };
    }
  };

  function asOfUnknownNote(s: ReportStageRule): string {
    return s.asOfRule.value === null ? `As-of rule for stage ${s.name} is unknown` : "Holder fiscal year end not provided for a fiscal_year_end rule";
  }

  /** As-of date for a stage from the presumed-abandoned date, with its derivation step; null when unknown. */
  function asOfDate(s: ReportStageRule, from: IsoDate): { date: IsoDate; step: DerivationStep } | null {
    const rule = s.asOfRule.value;
    const path = `reportStages[${s.name}].asOfRule`;
    if (rule === null) return null;
    if (rule.type === "fixed_cutoff") {
      const date = firstOnOrAfter(from, rule.month, rule.day);
      return { date, step: { kind: "as_of", from, month: rule.month, day: rule.day, result: date, basis: "fixed_cutoff", path } };
    }
    const fy = parseMMDD(input.holderFiscalYearEnd);
    if (!fy) return null;
    const date = firstOnOrAfter(from, fy.month, fy.day);
    return {
      date,
      step: {
        kind: "as_of",
        from,
        month: fy.month,
        day: fy.day,
        result: date,
        basis: "fiscal_year_end",
        fiscalYearEnd: input.holderFiscalYearEnd!,
        path,
      },
    };
  }

  const rolled = (b: IsoDate | null, deps: Dep[], extraNotes: string[] = [], steps: DerivationStep[] = []): DatedValue => {
    if (b === null) return unknown(rules, deps, extraNotes[0] ?? "Unknown");
    const allDeps = [...deps, rollDep];
    const roll = rollRv.value;
    if (roll === true) {
      const r = nextBusinessDay(b, holidays);
      const notes = [...extraNotes];
      let info: RollInfo | null = null;
      if (r !== b) {
        notes.push(`Rolled forward from ${b} to the next business day`);
        info = { from: b, to: r, fromWeekday: dayOfWeek(b), holiday: !isWeekend(b), path: "businessDayRollForward", verified: rollRv.verified };
      }
      return mk(rules, r, "ok", allDeps, notes, { steps, roll: info });
    }
    const notes = [...extraNotes];
    if (roll === null) notes.push("Business-day roll-forward rule is unknown; no roll applied");
    return mk(rules, b, "ok", allDeps, notes, { steps, roll: null });
  };

  const stageResults: StageTimeline[] = rules.reportStages.map((st) => {
    const r = resolveStage(st);
    let asOf: DatedValue;
    const asOfRule = st.asOfRule.value;
    const dAs = dep(`reportStages[${st.name}].asOfRule`, st.asOfRule);
    if (presumed.status !== "ok" || presumed.date === null) {
      asOf = unknown(rules, [dAs, ...presumedDeps], "Presumed-abandoned date is unknown");
    } else if (asOfRule === null) {
      asOf = unknown(rules, [dAs], `As-of rule for stage ${st.name} is unknown`);
    } else {
      const a = asOfDate(st, presumed.date);
      asOf = a
        ? mk(rules, a.date, "ok", [dAs, ...presumedDeps], [], { steps: [{ kind: "presumed_ref", date: presumed.date }, a.step], roll: null })
        : unknown(rules, [dAs], asOfUnknownNote(st));
    }
    const due = r.base === null ? r.value : rolled(r.base, r.deps, r.notes, r.steps);
    return { name: st.name, asOf, due, includesRemittance: st.includesRemittance };
  });

  /* ---- due diligence window */
  const dd = rules.dueDiligence;
  const dReq = dep("dueDiligence.required", dd.required);
  const dMin = dep("dueDiligence.minAmountCents", dd.minAmountCents);
  const dWin = dep("dueDiligence.windowDaysBeforeReport", dd.windowDaysBeforeReport);
  let ddApplies: boolean | null;
  let ddWindow: Timeline["ddWindow"];
  const first = stageResults[0];
  if (dd.required.value === null) {
    ddApplies = null;
    const u = () => unknown(rules, [dReq], "Whether due diligence is required is unknown");
    ddWindow = { start: u(), end: u() };
  } else if (dd.required.value === false) {
    ddApplies = false;
    const na = () => mk(rules, null, "not_applicable", [dReq], ["Due diligence not required in this state"]);
    ddWindow = { start: na(), end: na() };
  } else if (dd.minAmountCents.value === null) {
    ddApplies = null;
    const u = () => unknown(rules, [dReq, dMin], "Due-diligence minimum amount is unknown");
    ddWindow = { start: u(), end: u() };
  } else if (input.amountCents < dd.minAmountCents.value) {
    ddApplies = false;
    const na = () => mk(rules, null, "not_applicable", [dReq, dMin], ["Amount is below the due-diligence minimum"]);
    ddWindow = { start: na(), end: na() };
  } else {
    ddApplies = true;
    const win = dd.windowDaysBeforeReport.value;
    if (win === null || !first) {
      const u = () =>
        unknown(rules, [dReq, dMin, dWin], win === null ? "Due-diligence window is unknown" : "State has no report stages");
      ddWindow = { start: u(), end: u() };
    } else if (first.due.date === null) {
      const u = () => unknown(rules, [dReq, dMin, dWin, ...first.due.ruleRefs.map(refToDep(rules))], "First report due date is unknown");
      ddWindow = { start: u(), end: u() };
    } else {
      const deps = [dReq, dMin, dWin, ...first.due.ruleRefs.map(refToDep(rules))];
      const reportDue = first.due.date;
      const edge = (e: "opens" | "closes", days: number): DatedValue => {
        const result = addDays(reportDue, -days);
        return mk(rules, result, "ok", deps, [], {
          steps: [{ kind: "window_before", edge: e, stage: first.name, reportDue, days, result, path: dWin.path }],
          roll: null,
        });
      };
      ddWindow = {
        start:
          win.max === null
            ? presumed.date === null
              ? unknown(rules, deps, "Presumed-abandoned date is unknown")
              : mk(
                  rules,
                  presumed.date,
                  "ok",
                  [...deps, ...presumedDeps],
                  ["Statute sets no earliest notice date; window opens when the property is presumed abandoned"],
                  { steps: [{ kind: "window_at_presumed", date: presumed.date, path: dWin.path }], roll: null },
                )
            : edge("opens", win.max),
        end: edge("closes", win.min),
      };
    }
  }

  /* ---- remittance */
  const remitDep = dep("remitRule", rules.remitRule);
  const rr = rules.remitRule.value;
  let remitDue: DatedValue;
  if (rr === null) {
    remitDue = unknown(rules, [remitDep], "Remittance rule is unknown");
  } else if (rr.type === "with_report") {
    const st = byName.get(rr.stage);
    if (!st) remitDue = unknown(rules, [remitDep], `Remit rule references unknown stage ${rr.stage}`);
    else {
      const r = resolveStage(st);
      remitDue =
        r.base === null
          ? unknown(rules, [remitDep, ...r.deps], `Stage ${rr.stage} is unknown`)
          : rolled(r.base, [remitDep, ...r.deps], r.notes, [{ kind: "with_report", stage: rr.stage, path: "remitRule" }, ...r.steps]);
    }
  } else if (rr.type === "fixed_date") {
    const f = rules.reportStages[0];
    const fr = f ? resolveStage(f) : null;
    if (!fr || fr.asOfYear === null) {
      remitDue = unknown(rules, [remitDep, ...(fr?.deps ?? [])], "Cannot determine as-of year for a fixed-date remittance");
    } else {
      const base = fromYMD(fr.asOfYear + rr.yearOffset, rr.month, rr.day);
      remitDue = rolled(base, [remitDep, ...fr.deps], [], [
        { kind: "remit_fixed", month: rr.month, day: rr.day, yearOffset: rr.yearOffset, asOfYear: fr.asOfYear, result: base, path: "remitRule" },
      ]);
    }
  } else {
    const st = byName.get(rr.stage);
    if (!st) remitDue = unknown(rules, [remitDep], `Remit rule references unknown stage ${rr.stage}`);
    else {
      const r = resolveStage(st);
      if (r.base === null) remitDue = unknown(rules, [remitDep, ...r.deps], `Stage ${rr.stage} is unknown`);
      else {
        const d = rr.type === "after_stage" ? addMonths(r.base, rr.months) : addDays(r.base, rr.days);
        const step: DerivationStep =
          rr.type === "after_stage"
            ? { kind: "after_stage", stage: rr.stage, from: r.base, months: rr.months, result: d, path: "remitRule" }
            : { kind: "after_stage_days", stage: rr.stage, from: r.base, days: rr.days, result: d, path: "remitRule" };
        remitDue = rolled(d, [remitDep, ...r.deps], [], [{ kind: "stage_ref", stage: rr.stage, date: r.base }, step]);
      }
    }
  }

  /* ---- thresholds */
  const minRv = pt.minAmountCents;
  const aggRv = pt.aggregateThresholdCents;
  const minAmountApplies = minRv.value === null ? null : input.amountCents < minRv.value;
  const aggregate = aggRv.value === null ? null : input.amountCents < aggRv.value;
  const thresholdUnverified = (minRv.value !== null && !minRv.verified) || (aggRv.value !== null && !aggRv.verified);

  return finish({
    state: rules.state,
    propertyType: input.propertyType,
    rules: { state: rules.state, version: rules.version },
    presumedAbandoned: presumed,
    ddApplies,
    ddWindow,
    reportStages: stageResults,
    remitDue,
    minAmountApplies,
    aggregate,
    warnings,
  }, thresholdUnverified);
}

const refToDep = (rules: RuleFile) => (r: RuleRef): Dep => {
  const all = new Map<string, RuleValue<unknown>>();
  for (const [k, v] of Object.entries(rules.dueDiligence)) all.set(`dueDiligence.${k}`, v as RuleValue<unknown>);
  for (const [pt, rule] of Object.entries(rules.propertyTypes))
    for (const [k, v] of Object.entries(rule ?? {})) all.set(`propertyTypes.${pt}.${k}`, v as RuleValue<unknown>);
  for (const s of rules.reportStages) {
    all.set(`reportStages[${s.name}].asOfRule`, s.asOfRule as RuleValue<unknown>);
    all.set(`reportStages[${s.name}].dueRule`, s.dueRule as RuleValue<unknown>);
  }
  all.set("remitRule", rules.remitRule as RuleValue<unknown>);
  all.set("businessDayRollForward", rules.businessDayRollForward as RuleValue<unknown>);
  all.set("interest", rules.interest as RuleValue<unknown>);
  return { path: r.path, rv: all.get(r.path) ?? { value: null, sources: [], verified: false } };
};

function finish(t: Omit<Timeline, "anyUnverified" | "anyUnknown">, thresholdUnverified = false): Timeline {
  const dated: DatedValue[] = [
    t.presumedAbandoned,
    t.ddWindow.start,
    t.ddWindow.end,
    t.remitDue,
    ...t.reportStages.flatMap((s) => [s.asOf, s.due]),
  ];
  const anyUnknown = dated.some((d) => d.status === "unknown") || t.minAmountApplies === null || t.aggregate === null;
  const anyUnverified =
    dated.some((d) => d.status !== "unknown" && !d.verified) || thresholdUnverified || anyUnknown;
  return { ...t, anyUnverified, anyUnknown };
}

/* ------------------------------------------------------------------ audit interest */

export interface InterestItem {
  id: string;
  amountCents: number;
  /** Report due date from which interest accrues; null/undefined = unknown. */
  reportDueDate: IsoDate | null | undefined;
}

export interface InterestLine {
  id: string;
  status: "ok" | "unknown";
  days: number | null;
  interestCents: number | null;
}

export interface AuditInterest {
  status: "ok" | "unknown";
  totalCents: number | null;
  items: InterestLine[];
  verified: boolean;
  ruleRefs: RuleRef[];
  sources: RuleSource[];
  notes: string[];
}

/**
 * Simple interest from each item's report due date to `asOf`:
 *   interest = amount * annualRatePct/100 * (days / dayCount), days = max(0, asOf - due).
 * Recognised `basis` values (case-insensitive): contains "simple", "per annum", "annual" or "actual";
 * "360" in the string selects a 360-day year, otherwise 365. Anything else (e.g. "compound") is UNKNOWN,
 * never approximated. A null interest rule is UNKNOWN (the state's interest provision was not found).
 * The total is unknown if any line is unknown.
 */
export function computeAuditInterest(
  items: readonly InterestItem[],
  rules: Pick<RuleFile, "state" | "version" | "interest">,
  asOf: IsoDate,
): AuditInterest {
  const rv = rules.interest;
  const d = dep("interest", rv);
  const ruleRefs: RuleRef[] = [{ state: rules.state, version: rules.version, path: "interest" }];
  const sources = uniqSources([d]);
  const unknownAll = (note: string): AuditInterest => ({
    status: "unknown",
    totalCents: null,
    items: items.map((i) => ({ id: i.id, status: "unknown", days: null, interestCents: null })),
    verified: false,
    ruleRefs,
    sources,
    notes: [note],
  });

  const rule = rv.value;
  if (rule === null) return unknownAll("Interest rule is unknown");
  const basis = rule.basis.toLowerCase();
  if (/compound/.test(basis) || !/simple|per[ _-]?annum|annual|actual/.test(basis)) {
    return unknownAll(`Interest basis "${rule.basis}" is not supported; not approximated`);
  }
  const dayCount = /360/.test(basis) ? 360 : 365;
  const lines: InterestLine[] = items.map((i) => {
    if (!i.reportDueDate) return { id: i.id, status: "unknown", days: null, interestCents: null };
    const days = Math.max(0, diffDays(i.reportDueDate, asOf));
    return {
      id: i.id,
      status: "ok",
      days,
      interestCents: mulRateCents(i.amountCents, rule.annualRatePct / 100, days / dayCount),
    };
  });
  const anyUnknown = lines.some((l) => l.status === "unknown");
  return {
    status: anyUnknown ? "unknown" : "ok",
    totalCents: anyUnknown ? null : lines.reduce((a, l) => a + (l.interestCents ?? 0), 0),
    items: lines,
    verified: rv.verified && !anyUnknown,
    ruleRefs,
    sources,
    notes: [
      anyUnknown ? "One or more items have no report due date" : `Simple interest, ${dayCount}-day year`,
      ...(/cap|penalt|waiv/.test(basis) ? ["Rule text mentions caps, penalties or waivers that are NOT modelled; treat as an estimate"] : []),
    ],
  };
}
