import { cn } from "@/lib/utils";
import { statusMeta, TONE_DOT, TONE_OUTLINE, TONE_SOFT, TONE_SOLID } from "./status";

const STYLE = { soft: TONE_SOFT, outline: TONE_OUTLINE, solid: TONE_SOLID } as const;

/** One pill per row. Shape icon + label so status never relies on color alone. */
export function StatusPill({ status, className }: { status: string; className?: string }) {
  const m = statusMeta(status);
  const Icon = m.icon;
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium tracking-[0.01em] whitespace-nowrap",
        STYLE[m.style][m.tone],
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {m.label}
    </span>
  );
}

/** Dense variant for chart legends and tight cells. */
export function StatusDot({ status, className, withLabel }: { status: string; className?: string; withLabel?: boolean }) {
  const m = statusMeta(status);
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span aria-hidden className={cn("size-2 rounded-full", TONE_DOT[m.tone], m.style === "outline" && "bg-transparent ring-1 ring-current")} />
      {withLabel ? <span>{m.label}</span> : <span className="sr-only">{m.label}</span>}
    </span>
  );
}
