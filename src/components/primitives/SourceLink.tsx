"use client";

import { ExternalLink, Scale } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface SourceLinkProps {
  url: string;
  title: string;
  quote?: string;
  className?: string;
}

function shortTitle(title: string, url: string) {
  const t = title.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (t) return t.length > 34 ? `${t.slice(0, 33)}…` : t;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** External link to an official rule source; tooltip carries the full title and quoted text. */
export function SourceLink({ url, title, quote, className }: SourceLinkProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex max-w-full items-center gap-1 rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[11px] leading-4 text-muted-foreground transition-colors hover:text-foreground hover:underline",
              className,
            )}
          />
        }
      >
        <Scale className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{shortTitle(title, url)}</span>
        <ExternalLink className="size-3 shrink-0" aria-hidden />
        <span className="sr-only"> (opens in a new tab)</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm flex-col items-start gap-1">
        <span className="font-medium">{title || url}</span>
        {quote ? <span className="opacity-80">&ldquo;{quote.length > 360 ? `${quote.slice(0, 360)}…` : quote}&rdquo;</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}
