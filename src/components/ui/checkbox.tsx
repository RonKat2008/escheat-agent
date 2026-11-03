"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon, MinusIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Checkbox (§7): 16px box, blue-600 fill when checked, 24px hit area for WCAG 2.2 target size. */
export function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative inline-grid size-4 shrink-0 place-items-center rounded-[4px] border border-line-strong bg-ink-2 transition-colors duration-150 outline-none after:absolute after:-inset-1 hover:border-fg-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:opacity-45 data-checked:border-blue-600 data-checked:bg-blue-600 data-indeterminate:border-blue-600 data-indeterminate:bg-blue-600",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="group/ind text-white">
        <CheckIcon className="size-3 group-data-indeterminate/ind:hidden" strokeWidth={2.5} aria-hidden />
        <MinusIcon className="hidden size-3 group-data-indeterminate/ind:block" strokeWidth={2.5} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
