import Link from "next/link";

/** Lightning-bolt mark on a bolt-to-pink gradient tile. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`es-gradient-bg grid size-7 place-items-center rounded-[9px] shadow-[0_0_18px_-4px_var(--es-bolt-glow),inset_0_1px_0_rgb(255_255_255/0.35)] ${className ?? ""}`}
    >
      <svg viewBox="0 0 24 24" className="size-4 text-[#031019]" fill="currentColor">
        <path d="M13.2 2 4.5 13.4c-.4.5 0 1.1.6 1.1h5.1l-1.1 7.2c-.1.7.8 1 1.2.5l8.8-11.5c.4-.5 0-1.1-.6-1.1h-5.1l1-7.1c.1-.7-.8-1-1.2-.5Z" />
      </svg>
    </span>
  );
}

export function Brand() {
  return (
    <Link href="/dashboard" className="group flex items-center gap-2.5 rounded-md">
      <BrandMark className="transition-transform duration-150 group-hover:scale-105" />
      <span className="text-[15px] font-semibold tracking-[-0.01em]">Escheat Agent</span>
    </Link>
  );
}
