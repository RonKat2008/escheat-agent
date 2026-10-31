import { Check, TriangleAlert } from "lucide-react";
import type { Report } from "@/db/schema";
import { cn } from "@/lib/utils";
import "./stepper.css";

type StepState = "done" | "current" | "attention" | "error" | "future";

interface Step {
  key: string;
  label: string;
  state: StepState;
  note: string;
}

/** Maps the report row to the four-step filing path. Pink ring = waiting on a human; blue ring = in flight. */
export function buildSteps(report: Report | null, errorCount: number): Step[] {
  const s = report?.status ?? null;
  const past = (...list: string[]) => s !== null && list.includes(s);
  const generated: Step = { key: "generated", label: "Generated", state: report ? "done" : "future", note: report ? "NAUPA file built" : "Not started" };
  const validated: Step = !report
    ? { key: "validated", label: "Validated", state: "future", note: "" }
    : past("awaiting_approval", "approved", "submitted", "confirmed", "failed")
      ? { key: "validated", label: "Validated", state: "done", note: errorCount ? `${errorCount} error${errorCount > 1 ? "s" : ""} on file` : "No errors" }
      : errorCount > 0
        ? { key: "validated", label: "Validated", state: "error", note: `${errorCount} error${errorCount > 1 ? "s" : ""} to fix` }
        : s === "draft"
          ? { key: "validated", label: "Validated", state: "current", note: "Checking the file" }
          : { key: "validated", label: "Validated", state: "done", note: "No errors" };
  const awaiting: Step = !report
    ? { key: "awaiting", label: "Awaiting approval", state: "future", note: "" }
    : past("awaiting_approval")
      ? { key: "awaiting", label: "Awaiting approval", state: "attention", note: "Needs your approval" }
      : past("approved", "submitted", "confirmed")
        ? { key: "awaiting", label: "Awaiting approval", state: "done", note: "Approved" }
        : s === "failed"
          ? { key: "awaiting", label: "Awaiting approval", state: "error", note: "Filing failed" }
          : validated.state === "done"
            ? { key: "awaiting", label: "Awaiting approval", state: "current", note: "Filing agent fills the portal next" }
            : { key: "awaiting", label: "Awaiting approval", state: "future", note: "" };
  const submitted: Step = !report
    ? { key: "submitted", label: "Submitted", state: "future", note: "" }
    : past("submitted", "confirmed")
      ? { key: "submitted", label: "Submitted", state: "done", note: s === "confirmed" || report.replicaConfirmation ? "Confirmed" : "Awaiting confirmation" }
      : s === "approved"
        ? { key: "submitted", label: "Submitted", state: "current", note: "Agent is submitting" }
        : { key: "submitted", label: "Submitted", state: "future", note: "" };
  return [generated, validated, awaiting, submitted];
}

function Marker({ state }: { state: StepState }) {
  const base = "relative z-10 grid size-5 shrink-0 place-items-center rounded-full";
  if (state === "done")
    return (
      <span className={cn(base, "bg-blue-600 text-white")}>
        <Check className="size-3" strokeWidth={2.5} aria-hidden />
      </span>
    );
  if (state === "error")
    return (
      <span className={cn(base, "border border-pink-500 bg-ink-1 text-pink-400")}>
        <TriangleAlert className="size-3" strokeWidth={2} aria-hidden />
      </span>
    );
  if (state === "attention" || state === "current") {
    const pink = state === "attention";
    return (
      <span className={cn(base, "border-2 bg-ink-1", pink ? "border-pink-500" : "border-blue-500")}>
        <span className={cn("es-pulse size-1.5 rounded-full", pink ? "bg-pink-500" : "bg-blue-500")} />
      </span>
    );
  }
  return <span className={cn(base, "border border-fg-4 bg-ink-1")} />;
}

const STATE_WORD: Record<StepState, string> = { done: "done", current: "in progress", attention: "waiting on you", error: "blocked", future: "not started" };

export function FilingStepper({ report, errorCount }: { report: Report | null; errorCount: number }) {
  const steps = buildSteps(report, errorCount);
  return (
    <ol className="grid md:grid-cols-4" aria-label="Filing progress" data-testid="filing-stepper">
      {steps.map((st, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={st.key} className={cn("relative flex gap-3.5 md:flex-col md:gap-3", !last && "pb-7 md:pb-0")} aria-current={st.state === "current" || st.state === "attention" ? "step" : undefined}>
            {!last ? (
              <span aria-hidden className="absolute top-5 bottom-0 left-[9.5px] w-px bg-line md:top-[9.5px] md:right-2 md:bottom-auto md:left-7 md:h-px md:w-auto">
                {st.state === "done" ? <span className="rp-line-fill absolute inset-0 bg-blue-500" style={{ ["--i" as string]: i }} /> : null}
              </span>
            ) : null}
            <Marker state={st.state} />
            <div className="-mt-0.5 min-w-0 md:mt-0">
              <p className={cn("text-sm font-medium", st.state === "future" ? "text-fg-3" : st.state === "attention" || st.state === "error" ? "text-pink-400" : "text-fg-1")}>
                {st.label}
                <span className="sr-only"> ({STATE_WORD[st.state]})</span>
              </p>
              <p className="mt-0.5 min-h-5 text-[13px] text-fg-3">{st.note}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
