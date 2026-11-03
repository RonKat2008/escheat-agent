import { CheckCircle2, CircleAlert, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** pass: nothing to do. note: worth knowing, does not block. block: approval is refused until it is fixed. */
export type CheckLevel = "pass" | "note" | "block";
export interface SafetyCheck {
  id: string;
  level: CheckLevel;
  body: ReactNode;
}

const CHECK_ICON = { pass: CheckCircle2, note: Info, block: CircleAlert } as const;
const CHECK_TONE = { pass: "text-blue-500", note: "text-fg-3", block: "text-pink-400" } as const;
const CHECK_WORD = { pass: "Passed", note: "Note", block: "Blocks approval" } as const;

function CheckRow({ c }: { c: SafetyCheck }) {
  const Icon = CHECK_ICON[c.level];
  return (
    <li className="flex items-start gap-2.5" data-check={c.level}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", CHECK_TONE[c.level])} strokeWidth={1.75} aria-hidden />
      <span className={cn("text-[13px]", c.level === "block" ? "text-fg-1" : "text-fg-2")}>
        <span className="sr-only">{CHECK_WORD[c.level]}: </span>
        {c.body}
      </span>
    </li>
  );
}

/** Safety checks split by outcome: what needs attention first (blocking before notes), then what passed. Shape first, color second. */
export function SafetyChecks({ checks }: { checks: SafetyCheck[] }) {
  const attention = [...checks.filter((c) => c.level === "block"), ...checks.filter((c) => c.level === "note")];
  const passed = checks.filter((c) => c.level === "pass");
  const blocking = checks.some((c) => c.level === "block");
  return (
    <div className="grid gap-x-8 gap-y-5 md:grid-cols-2" data-testid="safety-checks">
      {attention.length > 0 ? (
        <div className="min-w-0">
          <h4 className="mb-2.5 flex items-center gap-2 text-xs text-fg-3">
            <span aria-hidden className={cn("size-1.5 rounded-full", blocking ? "bg-pink-500" : "bg-fg-3")} />
            {blocking ? "Needs attention" : "Worth knowing"} <span className="num text-fg-2">{attention.length}</span>
          </h4>
          <ul className="space-y-2.5">
            {attention.map((c) => (
              <CheckRow key={c.id} c={c} />
            ))}
          </ul>
        </div>
      ) : null}
      {passed.length > 0 ? (
        <div className={cn("min-w-0", attention.length === 0 && "md:col-span-2")}>
          <h4 className="mb-2.5 flex items-center gap-2 text-xs text-fg-3">
            <span aria-hidden className="size-1.5 rounded-full bg-blue-500" />
            Passed <span className="num text-fg-2">{passed.length}</span>
          </h4>
          <ul className="space-y-2.5">
            {passed.map((c) => (
              <CheckRow key={c.id} c={c} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
