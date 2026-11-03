"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/lib/utils";

/** Switch (§7): ink-4 track, blue-600 when on; the thumb moves with transform only. */
export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-line-hover bg-ink-4 p-0.5 transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:opacity-45 data-checked:border-blue-600 data-checked:bg-blue-600",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="size-3.5 rounded-full bg-fg-1 shadow-sm transition-transform duration-150 ease-out data-checked:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}
