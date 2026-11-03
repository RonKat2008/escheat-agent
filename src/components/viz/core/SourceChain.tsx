import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SourceChainSource {
  title?: string | null;
  url: string;
  quote?: string | null;
}

export interface SourceChainProps {
  value: ReactNode;
  rulePath?: string | null;
  sources: SourceChainSource[];
  verified?: boolean;
  className?: string;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function isHttp(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

/** value -> rule path -> source link(s), inline. */
export function SourceChain({ value, rulePath, sources, verified, className }: SourceChainProps) {
  const safe = sources.filter((s) => isHttp(s.url));
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]", className)}>
      <span className="text-fg-1">{value}</span>
      {rulePath ? (
        <>
          <span aria-hidden="true" className="text-fg-3">{"→"}</span>
          <code className="font-mono text-[12px] text-fg-2">{rulePath}</code>
        </>
      ) : null}
      {safe.map((s) => (
        <span key={s.url} className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="text-fg-3">{"→"}</span>
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-sm text-blue-400 hover:underline"
          >
            <span>{s.title || domainOf(s.url)}</span>
            {s.title ? <span className="text-fg-3">{domainOf(s.url)}</span> : null}
            <ExternalLink size={12} strokeWidth={1.5} aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </span>
      ))}
      {verified === false ? (
        <span className="rounded-sm border border-line-strong px-1 font-mono text-[10px] uppercase leading-4 tracking-[0.06em] text-fg-2">
          UNVERIFIED
        </span>
      ) : null}
    </span>
  );
}
