"use client";

import { useState, type ComponentType } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

type SheetComponent = ComponentType<{ counts?: Record<string, number>; open: boolean; onOpenChange: (open: boolean) => void }>;

/**
 * Nav collapses to a bottom sheet below 1024px. The button is always in the HTML; the sheet (dialog primitive, a second
 * SideNav) is code-split and loads on the first tap, which also opens it.
 */
export function MobileNav({ counts }: { counts?: Record<string, number> }) {
  const [Sheet, setSheet] = useState<SheetComponent | null>(null);
  const [open, setOpen] = useState(false);
  const waiting = counts?.["/approvals"] ?? 0;
  const show = () => {
    setOpen(true);
    if (!Sheet) {
      void import("./MobileNavSheet")
        .then((mod) => setSheet(() => mod.default as SheetComponent))
        .catch(() => setOpen(false));
    }
  };
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative lg:hidden"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={waiting > 0 ? `Open navigation, ${waiting} waiting for approval` : "Open navigation"}
        onClick={show}
      >
        <Menu className="size-[18px]" strokeWidth={1.5} aria-hidden />
        {waiting > 0 ? (
          <span
            aria-hidden
            className="num absolute top-0.5 right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-pink-500 px-1 text-[10px] leading-none font-semibold text-black"
          >
            {waiting}
          </span>
        ) : null}
      </Button>
      {Sheet ? <Sheet counts={counts} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
