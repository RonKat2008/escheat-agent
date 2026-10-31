import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

const LABEL: Record<string, string> = { running: "Running", succeeded: "Succeeded", failed: "Failed" };

/**
 * Run status by shape first (docs/DESIGN-RESEARCH.md 3.3):
 * running = pulsing blue dot, done = solid blue check, failed = pink outlined x. Always labelled.
 */
export function RunStatus({ status, className, labelClassName }: { status: string; className?: string; labelClassName?: string }) {
  const label = LABEL[status] ?? status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  let mark: React.ReactNode;
  if (status === "running") {
    mark = (
      <span aria-hidden className="relative grid size-3.5 place-items-center">
        <span className="absolute inset-0 rounded-full ring-1 ring-blue-500/50 ring-inset" />
        <span className="es-pulse size-1.5 rounded-full bg-blue-400" />
      </span>
    );
  } else if (status === "succeeded") {
    mark = (
      <span aria-hidden className="grid size-3.5 place-items-center rounded-full bg-blue-500">
        <Check className="size-2.5 text-black" strokeWidth={3} />
      </span>
    );
  } else if (status === "failed") {
    mark = (
      <span aria-hidden className="grid size-3.5 place-items-center rounded-full ring-[1.5px] ring-pink-500 ring-inset">
        <X className="size-2.5 text-pink-400" strokeWidth={2.5} />
      </span>
    );
  } else {
    mark = <span aria-hidden className="size-1.5 rounded-full bg-fg-3" />;
  }
  return (
    <span data-status={status} className={cn("inline-flex items-center gap-2 text-[13px] whitespace-nowrap", status === "failed" ? "text-pink-400" : "text-fg-2", className)}>
      {mark}
      <span className={labelClassName}>{label}</span>
    </span>
  );
}
