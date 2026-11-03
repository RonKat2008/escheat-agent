"use client";

import { m } from "motion/react";
import { SPRING } from "@/components/motion/tokens";
import { cn } from "@/lib/utils";
import { SAVED_VIEWS, type SavedViewId } from "./view-model";

/**
 * Saved views (§6.4): All · Needs action · Draft-ready · Due ≤ 90d, with counts. Needs action and Draft-ready are the
 * Loop Bar's Triage and Draft stages (same predicates), so the counts agree with the bar.
 */
export function SavedViews({ value, counts, onChange }: { value: SavedViewId; counts: Record<SavedViewId, number>; onChange: (v: SavedViewId) => void }) {
  return (
    <nav aria-label="Saved views" className="-mx-4 mb-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max items-end gap-1 border-b border-line">
        {SAVED_VIEWS.map((v) => {
          const active = v.id === value;
          return (
            <li key={v.id} className="relative">
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                data-testid={`view-${v.id}`}
                onClick={() => onChange(v.id)}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-t-md px-2.5 text-[13px] whitespace-nowrap transition-colors duration-150",
                  active ? "text-fg-1" : "text-fg-3 hover:text-fg-1",
                )}
              >
                {v.label}
                <span className={cn("num rounded-[4px] px-1 text-xs", active ? "bg-ink-4 text-fg-1" : "text-fg-3")} data-testid={`view-count-${v.id}`}>
                  {counts[v.id]}
                </span>
              </button>
              {active ? <m.span layoutId="items-view-underline" transition={SPRING.snappy} aria-hidden className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-blue-400" /> : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
