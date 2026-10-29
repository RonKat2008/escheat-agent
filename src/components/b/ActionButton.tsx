"use client";

import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type Variant = "approve" | "primary" | "quiet" | "danger";

const V: Record<Variant, string> = {
  approve: "bg-at-risk text-[#0b1220] hover:bg-[#ffb83d] font-semibold",
  primary: "bg-foreground text-background hover:bg-white font-medium",
  quiet: "border border-strong bg-transparent text-foreground hover:bg-raised font-medium",
  danger: "text-danger hover:bg-danger/10 font-medium",
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
        "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-sm whitespace-nowrap transition-[background-color,transform,opacity] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 max-sm:h-11",
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
