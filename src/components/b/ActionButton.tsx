"use client";

import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type Variant = "approve" | "primary" | "quiet" | "danger";

const V: Record<Variant, string> = {
  approve: "bg-blue-600 text-white hover:bg-[#3369ff] active:bg-blue-700 font-medium",
  primary: "bg-blue-600 text-white hover:bg-[#3369ff] active:bg-blue-700 font-medium",
  quiet: "border border-line-hover bg-ink-2 text-fg-1 hover:border-line-strong hover:bg-ink-3 font-medium",
  danger: "border border-pink-500/60 text-pink-400 hover:bg-pink-900/50 font-medium",
};

/** 36px hit target, designed disabled state, inline pending indicator (no layout shift). */
export function ActionButton({
  variant = "primary",
  pending,
  className,
  children,
  disabled,
  ...rest
}: { variant?: Variant; pending?: boolean } & Omit<ComponentProps<"button">, "type"> & { type?: "button" | "submit" }) {
  return (
    <button
      type="button"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-2 rounded-md px-3.5 text-[13px] whitespace-nowrap transition-[background-color,transform,opacity] duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100 max-sm:h-10",
        V[variant],
        className,
      )}
      {...rest}
    >
      {pending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
      {children}
    </button>
  );
}
