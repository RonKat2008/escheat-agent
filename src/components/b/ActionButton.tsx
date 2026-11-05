"use client";

import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { PRIMARY, SECONDARY } from "@/components/ui/button";

type Variant = "approve" | "primary" | "quiet" | "danger";

const V: Record<Variant, string> = {
  // V4: approving is the human act, so approve and primary are the coral pill; quiet is the glass pill.
  approve: PRIMARY,
  primary: PRIMARY,
  quiet: cn("border font-medium", SECONDARY),
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
        "inline-flex h-8 items-center justify-center gap-2 rounded-full px-4 text-[13px] whitespace-nowrap transition-[background-color,transform,opacity] duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100 max-sm:h-10",
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
