/**
 * R6-01 / opportunity #1: the FROZEN filing record. When a person approves a report for submission, the facts they
 * approved are written once onto the report row (reports.filing_record) and never recomputed from live items: the
 * report due date, how late it was, the late interest disclosed (with its verified flag), the exact UNVERIFIED
 * rule-value count acknowledged, any due-diligence notice that was never sent, the validator warning count, the stage
 * (notice vs remit) and what the rules say comes next. The receipt, Reports and the evidence pack all print from it,
 * so recording the remittance (or anything else that later moves the items) cannot rewrite the paper trail.
 *
 * Pure: types, the parser for the stored JSON, and the stage helpers. The DB loader is close-out/filing-record.ts.
 */
import type { RuleFile } from "../../../rules/schema";
import type { StateInterest } from "./late-money";

/** A date the rules engine computed, with whether a person has verified the rule values behind it. */
export interface SourcedDate {
  date: string;
  unverified: boolean;
}

/** A due-diligence notice the rules required for an item in this report, which never went out (R6-09). */
export interface UnsentNotice {
  staleItemId: string;
  payeeName: string;
  amountCents: number;
  /** When the item's due-diligence window closed (engine date), or null when unknown. */
  windowClosed: string | null;
  /** Why it never went out, in plain words ("blocked: owner mailing address is missing"). */
  reason: string;
}

/** How the approver was identified: a passcode session, or no sign-in configured (name typed in the browser). */
export type SignIn = "passcode" | "none_configured";

/** The report stage after the filed one, from the rule file (CA: notice, then remit). */
export interface NextStage {
  name: string;
  remits: boolean;
  /** Earliest engine-computed due date of the filed items for that stage; null = UNKNOWN (never invented). */
  due: SourcedDate | null;
}

export interface FilingRecord {
  version: 1;
  /** ISO timestamp (system clock) the record was frozen. */
  frozenAt: string;
  /** The demo-clock date the approval was given on: days late and interest are as of this date. */
  asOf: string;
  state: string;
  stage: string | null;
  /** Whether the filed stage carries money (rule file reportStages[*].includesRemittance); null = unknown. */
  stageRemits: boolean | null;
  nextStage: NextStage | null;
  itemCount: number;
  totalCents: number;
  checksum: string | null;
  errorCount: number;
  /** The one shared validator counter (validation-summary.ts) over the stored validation list. */
  warningCount: number;
  reportDue: SourcedDate | null;
  daysLate: number | null;
  interest: StateInterest;
  /** The remit due date when this stage remits; null for a notice-only stage (see nextStage). */
  remitDue: SourcedDate | null;
  /** UNVERIFIED rule values the file relied on at approval (the count shown in "approve anyway"). */
  unverifiedRuleCount: number;
  /** The person ticked "approve anyway" for exactly that count. */
  unverifiedAcknowledged: boolean;
  unsentNotices: UnsentNotice[];
  unsentAcknowledged: boolean;
  /** The typed approver name, exactly as typed (no session suffix). */
  approvedBy: string;
  approvedAt: string | null;
  approvalId: string | null;
  signIn: SignIn | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The stored JSON, or null when absent or not a version-1 record (reports filed before records existed). */
export function parseFilingRecord(raw: unknown): FilingRecord | null {
  if (!isObj(raw) || raw.version !== 1) return null;
  if (typeof raw.asOf !== "string" || typeof raw.approvedBy !== "string" || typeof raw.unverifiedRuleCount !== "number") return null;
  if (!isObj(raw.interest)) return null;
  return {
    ...(raw as unknown as FilingRecord),
    unsentNotices: Array.isArray(raw.unsentNotices) ? (raw.unsentNotices as UnsentNotice[]) : [],
  };
}

/** The stage a report was generated for, and whether it remits (null when the rule file does not name it). */
export function stageOf(rules: RuleFile | null, stage: string | null): { name: string | null; remits: boolean | null; index: number } {
  if (!rules || !stage) return { name: stage, remits: null, index: -1 };
  const index = rules.reportStages.findIndex((s) => s.name === stage);
  return { name: stage, remits: index >= 0 ? Boolean(rules.reportStages[index]!.includesRemittance) : null, index };
}

/**
 * The stage after the filed one (CA notice -> remit). Its due date is the filed items' engine-computed remit date
 * when that stage remits; any other stage's date is not stored per item, so it stays UNKNOWN rather than invented.
 */
export function nextStageOf(rules: RuleFile | null, stage: string | null, itemRemitDue: SourcedDate | null): NextStage | null {
  const s = stageOf(rules, stage);
  if (!rules || s.index < 0) return null;
  const next = rules.reportStages[s.index + 1];
  if (!next) return null;
  const remits = Boolean(next.includesRemittance);
  const due = remits && itemRemitDue ? { date: itemRemitDue.date, unverified: itemRemitDue.unverified || !next.dueRule.verified } : null;
  return { name: next.name, remits, due };
}

/** "remit" -> "Remit report", "notice" -> "Notice report". */
export const stageLabel = (name: string): string => `${name.charAt(0).toUpperCase()}${name.slice(1)} report`;
