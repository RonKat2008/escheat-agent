"use client";

import { Suspense, useEffect, useRef } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Brand } from "./Brand";
import { useShellNav } from "./ShellFrame";
import { SideNav } from "./SideNav";
import { useShellPathname } from "./useShellLocation";

/**
 * The menu sheet (V4: the round ☰ at the right of the top bar, every width). There is no rail any more, so this is
 * the full nav: company chip, every page grouped Work / Books / Setup / Agents, Settings, Sign out, and the Collapse
 * toggle (`[`), which switches the sheet to a compact icon column. Loaded on the first tap (see MobileNav).
 */
export default function MobileNavSheet({
  counts,
  open,
  onOpenChange,
}: {
  counts?: Record<string, number>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const shell = useShellNav();
  const collapsed = shell?.collapsed ?? false;
  const pathname = useShellPathname();
  const first = useRef(pathname);

  // The server-rendered nav body has no click callback, so close once the route changes.
  useEffect(() => {
    if (pathname === first.current) return;
    first.current = pathname;
    onOpenChange(false);
  }, [pathname, onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        data-testid="menu-sheet"
        className={cn(
          "glass-strong gap-0 data-[side=right]:inset-y-2 data-[side=right]:right-2 overflow-y-auto rounded-[22px] border px-3 pt-4 pb-[max(12px,env(safe-area-inset-bottom))] data-[side=right]:h-auto",
          collapsed ? "w-[84px] data-[side=right]:w-[84px]" : "w-[min(320px,calc(100vw-16px))] data-[side=right]:w-[min(320px,calc(100vw-16px))]",
        )}
        showCloseButton
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div data-collapsed={collapsed ? "true" : "false"} className="group/shell flex min-h-full flex-col">
          <div className="mb-5 px-2.5 group-data-[collapsed=true]/shell:px-1">
            <Brand />
          </div>
          <div className="flex flex-1 flex-col">
            {shell?.sidebar ?? (
              <Suspense fallback={null}>
                <SideNav onNavigate={() => onOpenChange(false)} counts={counts} layoutGroup="menu-nav" />
              </Suspense>
            )}
          </div>
          {shell ? (
            <button
              type="button"
              onClick={shell.toggle}
              aria-label={collapsed ? "Expand menu" : "Collapse menu"}
              aria-keyshortcuts="["
              aria-expanded={!collapsed}
              className="press mt-2 inline-flex h-8 items-center gap-2.5 rounded-full px-2.5 text-[13px] text-fg-3 transition-colors duration-150 hover:bg-fg-1/[0.06] hover:text-fg-2"
            >
              {collapsed ? <PanelLeftOpen className="size-4 shrink-0" strokeWidth={1.5} aria-hidden /> : <PanelLeftClose className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />}
              <span className="group-data-[collapsed=true]/shell:sr-only">Collapse</span>
              <kbd className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-line px-1 font-mono text-[11px] text-fg-3 group-data-[collapsed=true]/shell:hidden">
                [
              </kbd>
            </button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
