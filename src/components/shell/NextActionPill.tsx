"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { NextAction } from "@/lib/next-action";
import { cn } from "@/lib/utils";
import { SHELL_EVENTS } from "./useShortcuts";

/**
 * The one next best action (§5.2), at the right end of the Loop Bar. `.` anywhere (via the shell's registry) runs it;
 * Enter on the focused pill follows the link. Pink only when a person is needed now.
 */
export function NextActionPill({ action, className }: { action: NextAction; className?: string }) {
  const router = useRouter();
  useEffect(() => {
    const run = () => router.push(action.href);
    window.addEventListener(SHELL_EVENTS.runNextAction, run);
    return () => window.removeEventListener(SHELL_EVENTS.runNextAction, run);
  }, [router, action.href]);

  const text = action.detail ? `${action.label} · ${action.detail}` : action.label;
  return (
    <Link
      href={action.href}
      data-testid="next-action"
      data-kind={action.kind}
      aria-keyshortcuts="."
      aria-label={`Next action: ${text}. Shortcut: period.`}
      className={cn(
        "press group inline-flex h-7 max-w-full min-w-0 items-center gap-2 rounded-full border pr-1 pl-3 text-[13px] whitespace-nowrap transition-colors duration-150",
        action.human ? "border-pink-700 bg-pink-900 text-pink-300 hover:border-pink-500" : "border-line-hover bg-ink-2 text-fg-1 hover:border-line-strong hover:bg-ink-3",
        className,
      )}
    >
      <span className="min-w-0 truncate">
        <span className="font-medium">{action.label}</span>
        {action.detail ? <span className={cn("hidden sm:inline", action.human ? "text-pink-300" : "text-fg-2")}> · {action.detail}</span> : null}
      </span>
      <ArrowRight className="size-3.5 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={1.5} aria-hidden />
      <kbd className="hidden h-5 min-w-5 items-center justify-center rounded-full border border-line px-1.5 font-mono text-[11px] text-fg-2 xl:inline-flex" title="Keyboard shortcut: press .">Press .</kbd>
    </Link>
  );
}
