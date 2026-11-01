"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Native checkbox with a 40px hit area. `onToggle` receives shiftKey so callers can do range selection.
 * Clicks never bubble, so it can live inside a clickable row.
 */
export function RowCheckbox({
  checked,
  indeterminate = false,
  disabled,
  label,
  title,
  onToggle,
  className,
  ...rest
}: {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  label: string;
  title?: string;
  onToggle: (checked: boolean, shiftKey: boolean) => void;
  className?: string;
  "data-testid"?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <span
      className={cn("grid size-10 place-items-center", className)}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        title={title}
        aria-label={label}
        onChange={() => undefined}
        onClick={(e) => onToggle(!checked, e.shiftKey)}
        className="size-4 cursor-pointer rounded-sm accent-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
        {...rest}
      />
    </span>
  );
}
