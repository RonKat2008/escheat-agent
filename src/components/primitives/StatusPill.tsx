import { cn } from "@/lib/utils";
import { statusMeta, TONE_DOT, TONE_ICON, TONE_TEXT } from "./status";

/**
 * Status label. Only exceptions get a container:
 *   attention -> pink pill with black text (the loudest element on screen)
 *   error     -> pink outline on a pink-900 tint
 *   everything else -> icon + text, no container.
 */
export function StatusPill({ status, className }: { status: string; className?: string }) {
  const m = statusMeta(status);
  const Icon = m.icon;
  if (m.tone === "attention") {
    return (
      <span
        data-status={status}
        className={cn(
          "inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-pink-500 pr-2 pl-1.5 text-xs leading-none font-medium whitespace-nowrap text-black",
          className,
        )}
      >
        <Icon className="size-3" strokeWidth={2} aria-hidden />
        {m.label}
      </span>
    );
  }
  if (m.tone === "error") {
    return (
      <span
        data-status={status}
        className={cn(
          "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-pink-500/70 bg-pink-900/50 pr-2 pl-1.5 text-xs leading-none font-medium whitespace-nowrap text-pink-300",
          className,
        )}
      >
        <Icon className="size-3" aria-hidden />
        {m.label}
      </span>
    );
  }
  return (
    <span data-status={status} className={cn("inline-flex shrink-0 items-center gap-1.5 text-[13px] whitespace-nowrap", TONE_TEXT[m.tone], className)}>
      <Icon className={cn("size-3.5", TONE_ICON[m.tone])} strokeWidth={1.75} aria-hidden />
      {m.label}
    </span>
  );
}

/** Dense variant for tables and lists: a 6px dot + label. Hollow dots for unknown/error so shape differs too. */
export function StatusDot({ status, className, withLabel }: { status: string; className?: string; withLabel?: boolean }) {
  const m = statusMeta(status);
  return (
    <span data-status={status} className={cn("inline-flex items-center gap-2", className)}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[m.tone])} />
      {withLabel ? <span className={cn(m.tone === "attention" ? "text-fg-1" : TONE_TEXT[m.tone])}>{m.label}</span> : <span className="sr-only">{m.label}</span>}
    </span>
  );
}
