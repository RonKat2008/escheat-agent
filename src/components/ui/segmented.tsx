"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible name when the label is an icon. */
  ariaLabel?: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /** Accessible name of the group. */
  label: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Segmented control (§7): a radiogroup of 2-4 options; the active one sits on ink-4. Arrow keys move between options
 * (roving tabindex), as for native radios.
 */
export function Segmented<T extends string>({ value, onValueChange, options, label, size = "md", className }: SegmentedProps<T>) {
  const name = useId();
  const move = (dir: 1 | -1) => {
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + dir + options.length) % options.length];
    if (next) onValueChange(next.value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("glass-pill inline-flex items-center gap-0.5 p-0.5", className)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            name={name}
            aria-checked={active}
            aria-label={o.ariaLabel}
            tabIndex={active ? 0 : -1}
            onClick={() => onValueChange(o.value)}
            className={cn(
              "press inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors duration-150",
              size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-[13px]",
              active ? "bg-fg-1/[0.12] text-fg-1 shadow-[inset_0_1px_0_rgb(244_237_224/0.1)]" : "text-fg-3 hover:text-fg-1",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
