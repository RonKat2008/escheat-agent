"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const FLASH_MS = 1000;

/** Copies `value`; the icon flashes a blue check for one second. */
export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setDone(false), FLASH_MS);
        } catch {
          /* clipboard blocked: leave the button as is */
        }
      }}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-xs text-fg-3 transition-[background-color,color] duration-150 hover:bg-ink-3 hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-400 active:scale-[0.97]",
        className,
      )}
    >
      <span className="relative grid size-3.5 place-items-center" aria-hidden>
        <Copy className={cn("absolute size-3.5 transition-[opacity,transform] duration-150", done ? "scale-75 opacity-0" : "opacity-100")} strokeWidth={1.5} />
        <Check className={cn("absolute size-3.5 text-blue-400 transition-[opacity,transform] duration-150", done ? "opacity-100" : "scale-75 opacity-0")} strokeWidth={2} />
      </span>
      <span aria-live="polite">{done ? "Copied" : label}</span>
    </button>
  );
}
