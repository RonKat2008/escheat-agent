import type { StageState } from "@/components/viz/core/StageTrack";

/**
 * Reports filing path (DESIGN-V3 §6.10): Generate → Validate → Approve → File → Confirmed, derived from the report row
 * only. Pure. State words follow StageTrack: done (blue check), active (the system is working), human (a person is
 * needed now, pink), waiting (next up), idle (not reached).
 */

export interface FilingReportLike {
  status: string;
  replicaConfirmation: string | null;
}

export type FilingStageId = "generate" | "validate" | "approve" | "file" | "confirmed";

export interface FilingStage {
  id: FilingStageId;
  label: string;
  state: StageState;
  /** Blocked by an error (pink + x shape), as opposed to waiting on a decision. */
  error: boolean;
  note: string;
}

const LABEL: Record<FilingStageId, string> = { generate: "Generate", validate: "Validate", approve: "Approve", file: "File", confirmed: "Confirmed" };

const AFTER_VALIDATE = ["awaiting_approval", "approved", "submitted", "confirmed", "failed"];

export function filingStages(report: FilingReportLike | null, errorCount: number, toReportCount = 0): FilingStage[] {
  const st = (id: FilingStageId, state: StageState, note: string, error = false): FilingStage => ({ id, label: LABEL[id], state, note, error });
  const errs = `${errorCount} error${errorCount === 1 ? "" : "s"}`;
  if (!report) {
    return [
      toReportCount > 0 ? st("generate", "waiting", `${toReportCount} item${toReportCount === 1 ? "" : "s"} ready`) : st("generate", "idle", "Nothing to report yet"),
      st("validate", "idle", ""),
      st("approve", "idle", ""),
      st("file", "idle", ""),
      st("confirmed", "idle", ""),
    ];
  }
  const s = report.status;
  const confirmed = s === "confirmed" || (s === "submitted" && Boolean(report.replicaConfirmation));
  const generate = st("generate", "done", "NAUPA file built");
  const validate = AFTER_VALIDATE.includes(s)
    ? st("validate", "done", errorCount ? `${errs} on file` : "No errors")
    : errorCount > 0
      ? st("validate", "human", `${errs} to fix`, true)
      : s === "draft"
        ? st("validate", "active", "Checking the file")
        : st("validate", "done", "No errors");
  const approve =
    s === "awaiting_approval"
      ? st("approve", "human", "Needs your approval")
      : ["approved", "submitted", "confirmed"].includes(s)
        ? st("approve", "done", "Approved")
        : validate.state === "done"
          ? st("approve", "waiting", "You approve before anything is filed")
          : st("approve", "idle", "");
  const file =
    s === "failed"
      ? st("file", "human", "Filing failed", true)
      : s === "approved"
        ? st("file", "active", "Agent is submitting")
        : s === "submitted" || s === "confirmed"
          ? st("file", "done", "Submitted")
          : validate.state === "done"
            ? st("file", "waiting", "Run the filing agent")
            : st("file", "idle", "");
  const done = confirmed
    ? st("confirmed", "done", report.replicaConfirmation ? `#${report.replicaConfirmation}` : "Confirmed")
    : s === "submitted"
      ? st("confirmed", "active", "Awaiting confirmation")
      : st("confirmed", "idle", "");
  return [generate, validate, approve, file, done];
}

export interface StatePick {
  state: string;
  hasReport: boolean;
  toReportCount: number;
  status: string | null;
  /** Report/remittance deadlines already missed in this state (R4-14: the most urgent state opens first). */
  overdueCount?: number;
}

/**
 * Which state the page shows. ?state=XX wins when valid. ?filter=approved (the Loop Bar's "File" stage) picks the
 * first state whose report is approved and waiting to be filed. Otherwise the state with the most overdue obligations
 * (R4-14), then the first state with work.
 */
export function pickState(states: StatePick[], requested: string | null | undefined, filter: string | null | undefined): { state: string; filterMatched: boolean | null } {
  const want = requested?.toUpperCase();
  const byState = states.find((s) => s.state === want);
  if (byState) return { state: byState.state, filterMatched: filter === "approved" ? byState.status === "approved" : null };
  if (filter === "approved") {
    const approved = states.find((s) => s.status === "approved");
    if (approved) return { state: approved.state, filterMatched: true };
  }
  const mostOverdue = [...states].filter((s) => (s.overdueCount ?? 0) > 0).sort((a, b) => (b.overdueCount ?? 0) - (a.overdueCount ?? 0))[0];
  const busy = mostOverdue ?? states.find((s) => s.toReportCount > 0 || s.hasReport) ?? states[0]!;
  return { state: busy.state, filterMatched: filter === "approved" ? false : null };
}
