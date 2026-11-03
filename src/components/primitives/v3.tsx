import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleDashed, CircleDot, Circle, OctagonX, type LucideIcon } from "lucide-react";
import { DISCLAIMER } from "@/lib/disclaimer";
import { cn } from "@/lib/utils";
import { statusMeta, type Tone } from "./status";

/** Instrument label (§1.3): Geist Mono 11px / 500 / uppercase / +0.08em / fg-3. Eyebrows, axis and stage names. */
export function InstrumentLabel({ children, className, as: Tag = "span", id }: { children: ReactNode; className?: string; as?: "span" | "p" | "h2" | "h3" | "div"; id?: string }) {
  return (
    <Tag id={id} className={cn("instrument-label", className)}>
      {children}
    </Tag>
  );
}

/** e1 panel (§1.4): ink-2 + 1px line, radius 10. Optional instrument-label title and right-side action. */
export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
  as: Tag = "section",
  "aria-label": ariaLabel,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: "section" | "div" | "article";
  "aria-label"?: string;
}) {
  return (
    <Tag aria-label={ariaLabel} className={cn("rounded-[10px] border border-line bg-ink-2", className)}>
      {title || action ? (
        <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
          {title ? <InstrumentLabel as="h2">{title}</InstrumentLabel> : <span />}
          {action}
        </div>
      ) : null}
      <div className={cn("px-4 pt-3 pb-4", bodyClassName)}>{children}</div>
    </Tag>
  );
}

/** §1.7 status shapes: circle = watching, circle-dot = in progress, circle-check = done, circle-alert = needs you, circle-dashed = unknown. */
const TONE_SHAPE: Record<Tone, LucideIcon> = {
  neutral: Circle,
  active: CircleDot,
  done: CircleCheck,
  attention: CircleAlert,
  unknown: CircleDashed,
  error: OctagonX,
};
const TONE_CLASS: Record<Tone, { icon: string; text: string }> = {
  neutral: { icon: "text-fg-3", text: "text-fg-2" },
  active: { icon: "text-blue-400", text: "text-fg-1" },
  done: { icon: "text-blue-500", text: "text-fg-2" },
  attention: { icon: "text-pink-400", text: "text-pink-400" },
  unknown: { icon: "text-fg-3", text: "text-fg-3 italic" },
  error: { icon: "text-pink-400", text: "text-pink-300" },
};

/**
 * Status as shape + label first, color second (§1.2 hard rules). Reads the single map in ./status.ts.
 * Prefer this over StatusPill in new V3 surfaces.
 */
export function StatusLabel({ status, className, size = "md" }: { status: string; className?: string; size?: "sm" | "md" }) {
  const m = statusMeta(status);
  const Icon = TONE_SHAPE[m.tone];
  const c = TONE_CLASS[m.tone];
  return (
    <span data-status={status} className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap", size === "sm" ? "text-xs" : "text-[13px]", c.text, className)}>
      <Icon className={cn(size === "sm" ? "size-3.5" : "size-4", c.icon)} strokeWidth={1.5} aria-hidden />
      {m.label}
    </span>
  );
}

/** An unknown value (§1.1 principle 2): the word Unknown with a hollow dashed marker. Never an estimate. */
export function UnknownValue({ className, label = "Unknown", reason }: { className?: string; label?: string; reason?: string }) {
  return (
    <span data-testid="unknown-value" title={reason} className={cn("inline-flex items-center gap-1.5 text-[13px] text-fg-3 italic", className)}>
      <span aria-hidden className="size-2 shrink-0 rounded-full border border-dashed border-fg-3" />
      {label}
      {reason ? <span className="sr-only">: {reason}</span> : null}
    </span>
  );
}

/** The disclaimer line, always imported from src/lib/disclaimer.ts (§8.1). */
export function Disclaimer({ className }: { className?: string }) {
  return <p className={cn("text-xs text-fg-3", className)}>{DISCLAIMER}</p>;
}
