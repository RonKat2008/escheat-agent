import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FilingStage } from "./filing-model";
import "./stepper.css";

const STATE_WORD: Record<FilingStage["state"], string> = {
  done: "done",
  active: "in progress",
  human: "needs you",
  waiting: "next",
  idle: "not started",
  unknown: "unknown",
};

function Marker({ stage }: { stage: FilingStage }) {
  const base = "relative z-10 grid size-5 shrink-0 place-items-center rounded-full";
  if (stage.state === "done")
    return (
      <span className={cn(base, "bg-blue-600 text-white")}>
        <Check className="size-3" strokeWidth={2.5} aria-hidden />
      </span>
    );
  if (stage.error)
    return (
      <span className={cn(base, "border border-pink-500 bg-ink-1 text-pink-400")}>
        <X className="size-3" strokeWidth={2.5} aria-hidden />
      </span>
    );
  if (stage.state === "human" || stage.state === "active") {
    const pink = stage.state === "human";
    return (
      <span className={cn(base, "border-2 bg-ink-1", pink ? "border-pink-500" : "border-blue-500")}>
        <span className={cn("es-pulse size-1.5 rounded-full", pink ? "bg-pink-500" : "bg-blue-500")} />
      </span>
    );
  }
  return <span className={cn(base, "border bg-ink-1", stage.state === "waiting" ? "border-fg-3" : "border-dashed border-fg-4")} />;
}

/** §6.10 filing stepper hero: Generate → Validate → Approve → File → Confirmed. The rail fills (scaleX) as steps complete. */
export function FilingStepper({ stages }: { stages: FilingStage[] }) {
  return (
    <ol className="grid md:grid-cols-5" aria-label="Filing progress" data-testid="filing-stepper">
      {stages.map((st, i) => {
        const last = i === stages.length - 1;
        const needsYou = st.state === "human";
        return (
          <li
            key={st.id}
            data-stage={st.id}
            data-state={st.state}
            className={cn("relative flex gap-3.5 md:flex-col md:gap-3", !last && "pb-7 md:pb-0")}
            aria-current={st.state === "active" || needsYou ? "step" : undefined}
          >
            {!last ? (
              <span aria-hidden className="absolute top-5 bottom-0 left-[9.5px] w-px bg-line md:top-[9.5px] md:right-2 md:bottom-auto md:left-7 md:h-px md:w-auto">
                {st.state === "done" ? <span className="rp-line-fill absolute inset-0 bg-blue-500" style={{ ["--i" as string]: i }} /> : null}
              </span>
            ) : null}
            <Marker stage={st} />
            <div className="-mt-0.5 min-w-0 md:mt-0">
              <p className={cn("text-sm font-medium", st.state === "idle" ? "text-fg-3" : needsYou ? "text-pink-400" : "text-fg-1")}>
                {st.label}
                <span className="sr-only"> ({STATE_WORD[st.state]})</span>
              </p>
              <p className="mt-0.5 min-h-5 text-[13px] break-words text-fg-3">{st.note}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
