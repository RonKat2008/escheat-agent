"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { activeSection, isActive, NAV_SECTIONS, sectionPages, type NavSection } from "./nav-items";
import { useShellPathname } from "./useShellLocation";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-400";

/** The coral count of things waiting on a person (the approvals queue). */
function WaitingCount({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="num ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-pink-500 px-1 text-[10.5px] leading-none font-semibold text-black">
      {n}
      <span className="sr-only"> waiting</span>
    </span>
  );
}

/**
 * A section with more than one page: its chevron opens a small glass dropdown (on hover or click) listing the pages.
 * The label itself still goes straight to the section's first page.
 */
function SectionMenu({ section, pathname, counts }: { section: NavSection; pathname: string; counts?: Record<string, number> }) {
  const pages = sectionPages(section);
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        openOnHover
        delay={120}
        closeDelay={160}
        aria-label={`${section.label} pages`}
        data-testid={`pill-nav-menu-${section.id}`}
        className={cn(
          "-ml-1.5 inline-grid h-8 w-6 place-items-center rounded-full text-fg-3 transition-colors duration-150 hover:text-fg-1 data-[popup-open]:text-fg-1",
          FOCUS,
        )}
      >
        <ChevronDown className="size-3.5 transition-transform duration-150 in-data-[popup-open]:rotate-180" strokeWidth={1.75} aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={12}
        data-testid={`pill-nav-dropdown-${section.id}`}
        className="glass-strong w-56 rounded-[18px] border-line-hover p-1.5"
      >
        <nav aria-label={`${section.label} pages`}>
          <ul className="flex flex-col gap-0.5">
            {pages.map((p) => {
              const Icon = p.icon;
              const here = isActive(pathname, p);
              return (
                <li key={p.href}>
                  <Link
                    href={p.href}
                    aria-current={here ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex h-9 items-center gap-2.5 rounded-full px-3 text-[13px] transition-colors duration-150",
                      FOCUS,
                      here ? "bg-fg-1/[0.1] text-fg-1" : "text-fg-2 hover:bg-fg-1/[0.06] hover:text-fg-1",
                    )}
                  >
                    <Icon className="size-4 shrink-0 text-fg-3" strokeWidth={1.5} aria-hidden />
                    <span className="flex-1 truncate">{p.label}</span>
                    {here ? <span aria-hidden className="size-1.5 rounded-full bg-blue-300" /> : null}
                    <WaitingCount n={counts?.[p.href] ?? 0} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The centred translucent pill nav (V4, like the reference's "Stays · Journal · Gift cards · About us"). The active
 * section is a smaller inner pill with a coral dot. Sections with several pages get a chevron that opens a small glass
 * dropdown of those pages. `counts` maps an href to a number that needs a person (the approvals queue), shown as a coral
 * count. Hydration-safe pathname (useShellLocation.ts). Self-contained so a mode switch can sit beside it later.
 */
export function SectionNav({ counts, className }: { counts?: Record<string, number>; className?: string }) {
  const pathname = useShellPathname();
  const current = activeSection(pathname);
  return (
    <nav aria-label="Sections" data-testid="pill-nav" className={cn("glass-pill p-1", className)}>
      <ul className="flex items-center gap-0.5">
        {NAV_SECTIONS.map((s) => {
          const active = current?.id === s.id;
          const multi = sectionPages(s).length > 1;
          return (
            <li
              key={s.id}
              className={cn(
                "flex items-center rounded-full transition-[background-color] duration-150",
                active ? "bg-fg-1/[0.12] shadow-[inset_0_1px_0_rgb(244_237_224/0.12),0_1px_6px_-2px_rgb(3_7_20/0.5)]" : "hover:bg-fg-1/[0.06]",
                multi && "pr-1",
              )}
            >
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                data-active={active ? "true" : "false"}
                data-testid={`pill-nav-${s.id}`}
                className={cn(
                  "relative inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] whitespace-nowrap transition-colors duration-150",
                  FOCUS,
                  active ? "font-medium text-fg-1" : "text-fg-2 hover:text-fg-1",
                )}
              >
                {active ? <span aria-hidden data-testid="pill-nav-dot" className="size-1.5 rounded-full bg-blue-300 shadow-[0_0_8px_rgb(189_206_238/0.5)]" /> : null}
                {s.label}
                <WaitingCount n={counts?.[s.href] ?? 0} />
              </Link>
              {multi ? <SectionMenu section={s} pathname={pathname} counts={counts} /> : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
