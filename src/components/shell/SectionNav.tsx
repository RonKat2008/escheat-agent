"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { activeSection, NAV_SECTIONS } from "./nav-items";
import { useShellPathname } from "./useShellLocation";

/**
 * The centred translucent pill nav (V4, like the reference's "Stays · Journal · Gift cards · About us"). The active
 * section is a smaller inner pill with a coral dot. `counts` maps a section href to a number that needs a person
 * (the approvals queue), shown as a coral count. Hydration-safe pathname (useShellLocation.ts).
 */
export function SectionNav({ counts, className }: { counts?: Record<string, number>; className?: string }) {
  const pathname = useShellPathname();
  const current = activeSection(pathname);
  return (
    <nav aria-label="Sections" data-testid="pill-nav" className={cn("glass-pill p-1", className)}>
      <ul className="flex items-center gap-0.5">
        {NAV_SECTIONS.map((s) => {
          const active = current?.id === s.id;
          const n = counts?.[s.href] ?? 0;
          return (
            <li key={s.id}>
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                data-active={active ? "true" : "false"}
                data-testid={`pill-nav-${s.id}`}
                className={cn(
                  "relative inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] whitespace-nowrap transition-[background-color,color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-400",
                  active
                    ? "bg-fg-1/[0.12] font-medium text-fg-1 shadow-[inset_0_1px_0_rgb(244_237_224/0.12),0_1px_6px_-2px_rgb(3_7_20/0.5)]"
                    : "text-fg-2 hover:bg-fg-1/[0.06] hover:text-fg-1",
                )}
              >
                {active ? <span aria-hidden data-testid="pill-nav-dot" className="size-1.5 rounded-full bg-pink-500 shadow-[0_0_8px_rgb(255_107_91/0.8)]" /> : null}
                {s.label}
                {n > 0 ? (
                  <span className="num ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-pink-500 px-1 text-[10.5px] leading-none font-semibold text-black">
                    {n}
                    <span className="sr-only"> waiting</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
