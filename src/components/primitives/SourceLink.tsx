"use client";

import { ExternalLink, Scale } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface SourceLinkProps {
  url: string;
  title: string;
  quote?: string;
  className?: string;
  /** Longest visible title before it is cut with an ellipsis (the tooltip always has the full title). */
  maxChars?: number;
}

function shortTitle(title: string, url: string, max: number) {
  const t = title.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (t) return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** External link to an official rule source; tooltip carries the full title and quoted text. */
export function SourceLink({ url, title, quote, className, maxChars = 34 }: SourceLinkProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex max-w-full items-center gap-1 rounded-sm text-xs leading-4 text-blue-400 underline decoration-blue-400/30 underline-offset-2 transition-colors duration-150 hover:text-blue-300 hover:decoration-blue-300",
              className,
            )}
          />
        }
      >
        <Scale className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{shortTitle(title, url, maxChars)}</span>
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
