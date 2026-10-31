"use client";

import { createContext, use, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, CircleAlert, Clock } from "lucide-react";
import { StatusPill, UnknownBadge, UnverifiedBadge, VerifiedMark } from "@/components/primitives";
import { formatUSD } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Lets a view ask a follow-up as if the user typed it (e.g. clicking a state in the exposure chart). */
export interface ChatActions {
  ask: (text: string) => void;
  canAsk: boolean;
}
export const ChatActionsContext = createContext<ChatActions>({ ask: () => undefined, canAsk: false });
export const useChatActions = () => use(ChatActionsContext);

export const usd = (cents: number) => formatUSD(cents);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Formats an ISO date (YYYY-MM-DD) without timezone drift. */
export function fmtDate(iso: string | null | undefined, opts: { year?: boolean } = {}): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}${opts.year === false ? "" : `, ${y}`}`;
}

export const STATUS_LABEL: Record<string, string> = {
  watching: "Watching",
  dd_pending: "Due diligence due",
  dd_sent: "Due diligence sent",
  owner_responded: "Owner responded",
  resolved_paid: "Resolved",
  to_report: "To report",
  reported: "Reported",
  remitted: "Remitted",
  needs_rule: "Needs rule",
};

export const DEADLINE_LABEL: Record<string, string> = {
  dd_window_start: "Due-diligence window opens",
  dd_window_end: "Due-diligence window closes",
  report_due: "Report due",
  remit_due: "Remittance due",
};

/** One frame for every generative view: quiet header row, body, optional footer. */
export function ViewCard({
  icon,
  title,
  meta,
  children,
  footer,
  className,
  testId,
}: {
  icon: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className={cn("relative w-full min-w-0 overflow-hidden rounded-[10px] border border-[var(--chat-line)] bg-[var(--chat-ink-1)]", className)}
    >
      <header className="flex min-h-11 items-center gap-2.5 border-b border-[var(--chat-line)] px-4 py-2.5">
        <span className="text-[var(--chat-t3)] [&>svg]:size-4" aria-hidden>
          {icon}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--chat-t1)]">{title}</h3>
        {meta ? <div className="shrink-0 text-xs text-[var(--chat-t3)] tabular-nums">{meta}</div> : null}
      </header>
      <div>{children}</div>
      {footer ? <footer className="flex flex-wrap items-center gap-2 border-t border-[var(--chat-line)] px-4 py-2.5">{footer}</footer> : null}
    </section>
  );
}

/** Thin wrappers over the shared status primitives so every view speaks the same status language. */
export function UnverifiedFlag({ compact, className }: { compact?: boolean; className?: string }) {
  return <UnverifiedBadge compact={compact} className={className} />;
}

export function UnknownFlag({ className }: { className?: string }) {
  return <UnknownBadge label="Unknown" className={cn("text-xs", className)} />;
}

export function VerifiedFlag({ className }: { className?: string }) {
  return <VerifiedMark className={className} />;
}

/** At risk / due soon / awaiting you: the one filled pink element. Black text on pink, clock icon. */
export function AttentionPill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-[var(--chat-pink)] px-2 text-xs leading-none font-medium whitespace-nowrap text-black",
        className,
      )}
    >
      <Clock className="size-3" strokeWidth={2} aria-hidden />
      {children}
    </span>
  );
}

export function AttentionNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("flex gap-2 text-[13px] leading-relaxed text-[var(--chat-t2)]", className)}>
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-[var(--chat-pink-text)]" strokeWidth={1.5} aria-hidden />
      <span className="text-pretty">{children}</span>
    </p>
  );
}

/** Workflow status via the shared pill: attention is pink, done is a blue check, the resting state is plain text. */
export function StatusTag({ status }: { status: string }) {
  return <StatusPill status={status} className="text-xs" />;
}

export function FooterLink({ href, children, external }: { href: string; children: ReactNode; external?: boolean }) {
  const cls =
    "inline-flex h-8 items-center gap-1 rounded-md px-2 text-[13px] text-[var(--chat-t2)] outline-none transition-colors duration-150 hover:bg-[var(--chat-ink-3)] hover:text-[var(--chat-t1)] focus-visible:ring-2 focus-visible:ring-[var(--chat-blue-text)]";
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {children}
      <ArrowUpRight className="size-3.5 opacity-60" aria-hidden />
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
      <ArrowUpRight className="size-3.5 opacity-60" aria-hidden />
    </Link>
  );
}

/** A follow-up question rendered as a button; sends it as the user's next message. */
export function AskButton({ question, children, className }: { question: string; children: ReactNode; className?: string }) {
  const { ask, canAsk } = useChatActions();
  return (
    <button
      type="button"
      disabled={!canAsk}
      onClick={() => ask(question)}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--chat-line-strong)] px-2.5 text-[13px] text-[var(--chat-t1)] outline-none transition-[background-color,border-color,transform] duration-150 hover:border-[var(--chat-blue-text)]/50 hover:bg-[var(--chat-ink-3)] focus-visible:ring-2 focus-visible:ring-[var(--chat-blue-text)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}
