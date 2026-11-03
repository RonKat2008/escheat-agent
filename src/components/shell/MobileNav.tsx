"use client";

import { Suspense, useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Brand } from "./Brand";
import { SideNav } from "./SideNav";

/** Nav collapses to a left sheet below 1024px. */
export function MobileNav({ counts }: { counts?: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  const waiting = counts?.["/approvals"] ?? 0;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon" className="relative lg:hidden" aria-label={waiting > 0 ? `Open navigation, ${waiting} waiting for approval` : "Open navigation"} />}>
        <Menu className="size-[18px]" strokeWidth={1.5} aria-hidden />
        {waiting > 0 ? (
          <span
            aria-hidden
            className="num absolute top-0.5 right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-pink-500 px-1 text-[10px] leading-none font-semibold text-black"
          >
            {waiting}
          </span>
        ) : null}
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-[14px] border-line-strong px-3 pt-4 pb-[max(12px,env(safe-area-inset-bottom))]" showCloseButton>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="mb-6 px-2.5">
          <Brand />
        </div>
        <Suspense fallback={null}>
          <SideNav onNavigate={() => setOpen(false)} counts={counts} layoutGroup="mobile-nav" />
        </Suspense>
      </SheetContent>
    </Sheet>
  );
}
