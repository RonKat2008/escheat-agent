import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Keyboard chip (§1.1 principle 6): mono 11px on ink-2 with a hairline. `keys` renders a sequence ("G" "D") as
 * separate chips; `children` renders one chip.
 */
export function Kbd({ children, keys, className }: { children?: ReactNode; keys?: readonly string[]; className?: string }) {
  const chip = (content: ReactNode, key?: string) => (
    <kbd
      key={key}
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-line bg-ink-2 px-1 font-mono text-[11px] leading-none font-medium text-fg-2",
        className,
      )}
    >
      {content}
    </kbd>
  );
  if (keys && keys.length > 0) {
    return <span className="inline-flex items-center gap-0.5">{keys.map((k, i) => chip(k, `${k}-${i}`))}</span>;
  }
  return chip(children);
}
