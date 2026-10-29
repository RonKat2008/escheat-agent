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
        <Menu className="size-5" aria-hidden />
      </SheetTrigger>
      <SheetContent side="left" className="w-64 gap-0 p-3 sm:max-w-64" showCloseButton>
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="mb-4 px-1 pt-1">
          <Brand />
        </div>
        <Suspense fallback={null}>
          <SideNav onNavigate={() => setOpen(false)} />
        </Suspense>
      </SheetContent>
    </Sheet>
  );
}
