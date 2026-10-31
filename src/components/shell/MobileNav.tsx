"use client";

import { Suspense, useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Brand } from "./Brand";
import { SideNav } from "./SideNav";

/** Nav collapses to a left sheet below 1024px. */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" />}>
        <Menu className="size-[18px]" strokeWidth={1.5} aria-hidden />
      </SheetTrigger>
      <SheetContent side="left" className="w-[264px] gap-0 px-3 pt-4 pb-3 sm:max-w-[264px]" showCloseButton>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="mb-6 px-2.5">
          <Brand />
        </div>
        <Suspense fallback={null}>
          <SideNav onNavigate={() => setOpen(false)} layoutGroup="mobile-nav" />
        </Suspense>
      </SheetContent>
    </Sheet>
  );
}
