"use client";

import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { kindMeta } from "./step-kinds";

export interface Shot {
  step: number;
  kind: string;
  label: string;
  src: string;
}

/** Full-size screenshot viewer. Esc closes (dialog), left/right arrows step through every screenshot in the run. */
export function ShotLightbox({ shots, index, onIndex, onClose }: { shots: Shot[]; index: number | null; onIndex: (i: number) => void; onClose: () => void }) {
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const cur = index != null ? shots[index] : undefined;
  const go = (d: number) => {
    if (index == null || shots.length === 0) return;
    onIndex((index + d + shots.length) % shots.length);
  };
  return (
    <Dialog open={cur != null} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent
        data-testid="shot-lightbox"
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-[min(1120px,calc(100vw-4rem))]"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            go(1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            go(-1);
          }
        }}
      >
        {cur ? (
          <>
            <div className="flex min-w-0 items-center gap-3 border-b border-line py-2.5 pr-12 pl-4">
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-[13px] leading-5 font-medium text-fg-1">
                  <span className="text-fg-3">
                    Step <span className="num">{cur.step + 1}</span> · {kindMeta(cur.kind).label}
                  </span>
                  <span className="mx-2 text-fg-4" aria-hidden>
                    /
                  </span>
                  {cur.label}
                </DialogTitle>
                <DialogDescription className="sr-only">Screenshot the agent took on this step. Use the left and right arrow keys to move between screenshots.</DialogDescription>
              </div>
              {shots.length > 1 ? (
                <div className="flex shrink-0 items-center gap-1">
                  <span className="num mr-1 text-xs text-fg-3" aria-live="polite">
                    {index! + 1} of {shots.length}
                  </span>
                  <Button variant="ghost" size="icon-sm" onClick={() => go(-1)} aria-label="Previous screenshot">
                    <ChevronLeft strokeWidth={1.5} />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => go(1)} aria-label="Next screenshot">
                    <ChevronRight strokeWidth={1.5} />
                  </Button>
                </div>
              ) : null}
            </div>
            <div className="max-h-[calc(100dvh-6rem)] overflow-auto bg-ink-0">
              {broken[cur.src] ? (
                <div className="flex aspect-[16/10] flex-col items-center justify-center gap-2 text-sm text-fg-3">
                  <ImageOff className="size-5" strokeWidth={1.5} aria-hidden />
                  The screenshot file is not stored on this server.
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- authenticated artifact route, not an optimisable static asset
                <img
                  key={cur.src}
                  src={cur.src}
                  alt={`Screenshot from step ${cur.step + 1}: ${cur.label}`}
                  width={1280}
                  height={800}
                  className="block h-auto w-full"
                  onError={() => setBroken((b) => ({ ...b, [cur.src]: true }))}
                />
              )}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
