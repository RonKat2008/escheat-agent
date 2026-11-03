"use client";

import { Suspense } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Brand } from "./Brand";
import { SideNav } from "./SideNav";

/** The sheet half of the mobile nav (loaded on the first tap of the menu button, see MobileNav). */
export default function MobileNavSheet({
  counts,
  open,
  onOpenChange,
}: {
  counts?: Record<string, number>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-[14px] border-line-strong px-3 pt-4 pb-[max(12px,env(safe-area-inset-bottom))]" showCloseButton>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="mb-6 px-2.5">
          <Brand />
        </div>
        <Suspense fallback={null}>
          <SideNav onNavigate={() => onOpenChange(false)} counts={counts} layoutGroup="mobile-nav" />
        </Suspense>
      </SheetContent>
    </Sheet>
  );
}
