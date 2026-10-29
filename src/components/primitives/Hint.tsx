"use client";

import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Keyboard-focusable inline trigger with a tooltip. */
export function Hint({ content, children, className }: { content: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} className={className} />}>{children}</TooltipTrigger>
      <TooltipContent className="max-w-xs flex-col items-start">{content}</TooltipContent>
    </Tooltip>
  );
}
