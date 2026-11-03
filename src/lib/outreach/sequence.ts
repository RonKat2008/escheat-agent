import { addDays, isIsoDate, type IsoDate } from "@/lib/dates";

/**
 * Channel sequencing for one owner's notice: the letter goes first, then an email, then a call.
 *
 * PRODUCT SETTING, NOT LAW. These gaps are this app's outreach cadence, chosen so a mailed letter has time to arrive
 * before the follow-ups. No statute in the rule files sets them; a state's own notice window (from the rule file)
 * still decides whether a notice counts. Change them here, never per state.
 */
export const EMAIL_AFTER_LETTER_DAYS = 14;
/** PRODUCT SETTING, NOT LAW: days after the email before the check-in call. */
export const CALL_AFTER_EMAIL_DAYS = 7;

export type SequenceChannel = "letter" | "email" | "voice";

export interface SequenceStepPlan {
  channel: SequenceChannel;
  /** Days after the letter goes out. */
  offsetDays: number;
  /** The planned date once the letter has a send date; null before that. */
  plannedOn: IsoDate | null;
}

/** Letter on day 0, email on day N, call N + M days after the letter. Pure. */
export function planNoticeSequence(letterSentOn: string | null): SequenceStepPlan[] {
  const base = letterSentOn && isIsoDate(letterSentOn) ? (letterSentOn as IsoDate) : null;
  const steps: [SequenceChannel, number][] = [
    ["letter", 0],
    ["email", EMAIL_AFTER_LETTER_DAYS],
    ["voice", EMAIL_AFTER_LETTER_DAYS + CALL_AFTER_EMAIL_DAYS],
  ];
  return steps.map(([channel, offsetDays]) => ({ channel, offsetDays, plannedOn: base ? addDays(base, offsetDays) : null }));
}

/** Short label for a step's timing: "Day 0", "Day 14", "Day 21". */
export function sequenceDayLabel(step: Pick<SequenceStepPlan, "offsetDays">): string {
  return `Day ${step.offsetDays}`;
}
