"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { PRIMARY } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The frame for Ask action cards: Tidewell glass (DESIGN-V4 §2), 18px radius, a quiet header, and a body the person
 * works in. Distinct from the read-only ViewCard so "you do something here" reads at a glance.
 */
export function ActionCardFrame({
  testId,
  icon,
  eyebrow,
  title,
  meta,
  children,
  footer,
}: {
  testId: string;
  icon: ReactNode;
  eyebrow: string;
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section data-testid={testId} className="glass @container relative w-full min-w-0 overflow-hidden rounded-[18px]">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 pt-4 pb-3 sm:px-5">
        <span className="glass-pill grid size-9 shrink-0 place-items-center text-blue-400 [&>svg]:size-4 [&>svg]:stroke-[1.5]" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="type-label">{eyebrow}</p>
          <h3 className="text-[15px] leading-6 font-medium text-pretty text-fg-1">{title}</h3>
        </div>
        {meta ? <div className="num shrink-0 pt-1 text-xs text-fg-3">{meta}</div> : null}
      </header>
      <div className="border-t border-line">{children}</div>
      {footer ? <footer className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 sm:px-5">{footer}</footer> : null}
    </section>
  );
}

/** Coral means a person must act: the link that takes them to where they act. Navy text on coral (6.5:1). */
export function CoralLink({ href, children, testId, className }: { href: string; children: ReactNode; testId?: string; className?: string }) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className={cn(
        PRIMARY,
        "inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] outline-none transition-[background-color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:scale-[0.98]",
        className,
      )}
    >
      {children}
      <ArrowUpRight className="size-3.5" strokeWidth={2} aria-hidden />
    </Link>
  );
}

/** A quiet navigational link (ghost, cream). */
export function GhostLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-[13px] text-fg-2 outline-none transition-colors duration-150 hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-blue-400"
    >
      {children}
      <ArrowUpRight className="size-3.5 opacity-70" strokeWidth={1.5} aria-hidden />
    </Link>
  );
}

/** Inline code for env var names and commands. */
export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-[6px] bg-ink-0/60 px-1.5 py-0.5 font-mono text-[12px] break-all text-fg-1">{children}</code>;
}
