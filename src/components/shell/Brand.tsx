import Link from "next/link";
import { Bolt } from "@/components/marketing/Bolt";

/** Flat mark, same as the marketing site: blue bolt on a faint blue tile with an inset hairline. No gradient, no glow. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`grid size-[26px] shrink-0 place-items-center rounded-[7px] bg-blue-500/10 text-[15px] text-blue-400 shadow-[inset_0_0_0_1px_rgb(61_123_255/0.4)] ${className ?? ""}`}
    >
      <Bolt />
    </span>
  );
}

export function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 rounded-md" aria-label="Escheat Agent, dashboard">
      <BrandMark />
      <span className="text-[15px] font-semibold tracking-[-0.015em] text-fg-1">Escheat Agent</span>
    </Link>
  );
}
