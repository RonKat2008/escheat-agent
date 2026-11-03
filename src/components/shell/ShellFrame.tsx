"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { ToastOutlet } from "./ToastOutlet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { emitShell, SHELL_EVENTS, useShortcuts } from "./useShortcuts";
import type { Shortcut } from "./shortcuts";

const COLLAPSE_KEY = "es-sidebar";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "collapsed";
  } catch {
    return false;
  }
}

interface ShellFrameProps {
  /** Sidebar body (brand, company, nav). */
  sidebar: ReactNode;
  /** Top bar + Loop Bar + main + footer. */
  children: ReactNode;
}

/**
 * The app frame (§6.0): a 232px sidebar collapsible to 56px with `[`, and the one global keyboard handler. The
 * collapsed state lives on `data-collapsed` so server-rendered nav children style themselves with
 * `group-data-[collapsed=true]/shell:` variants. It also hosts the tooltip delay group and the toast outlet, which
 * only app routes use (kept out of the root layout so the marketing pages do not load them).
 */
export function ShellFrame({ sidebar, children }: ShellFrameProps) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore the saved preference after hydration
    setCollapsed(readCollapsed());
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "expanded" : "collapsed");
      } catch {
        /* storage blocked: still toggles for this view */
      }
      return !c;
    });
  }, []);

  useEffect(() => {
    window.addEventListener(SHELL_EVENTS.toggleSidebar, toggle);
    return () => window.removeEventListener(SHELL_EVENTS.toggleSidebar, toggle);
  }, [toggle]);

  const onShortcut = useCallback(
    (s: Shortcut) => {
      if (s.href) return router.push(s.href);
      if (s.id === "palette") return emitShell(SHELL_EVENTS.togglePalette);
      if (s.id === "shortcuts") return emitShell(SHELL_EVENTS.openShortcuts);
      if (s.id === "next-action") return emitShell(SHELL_EVENTS.runNextAction);
      if (s.id === "sidebar") return toggle();
    },
    [router, toggle],
  );
  useShortcuts(onShortcut);

  return (
    <TooltipProvider delay={200}>
      <div
        data-collapsed={collapsed ? "true" : "false"}
        className={cn(
          "group/shell min-h-screen bg-ink-0 lg:grid",
          collapsed ? "lg:grid-cols-[56px_minmax(0,1fr)]" : "lg:grid-cols-[232px_minmax(0,1fr)]",
        )}
      >
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-ink-3 focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        {/* The grid column carries the background/border so it spans the full page height; the inner nav stays pinned. */}
        <div className="hidden border-r border-line bg-ink-1 lg:block">
          <aside aria-label="Sidebar" className={cn("sticky top-0 flex h-dvh flex-col pt-4 pb-3", collapsed ? "px-2" : "px-3")}>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{sidebar}</div>
            <button
              type="button"
              onClick={toggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-keyshortcuts="["
              aria-expanded={!collapsed}
              className="press mt-2 inline-flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] text-fg-3 transition-colors duration-150 hover:bg-ink-2 hover:text-fg-2"
            >
              {collapsed ? <PanelLeftOpen className="size-4 shrink-0" strokeWidth={1.5} aria-hidden /> : <PanelLeftClose className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />}
              <span className="group-data-[collapsed=true]/shell:sr-only">Collapse</span>
              <kbd className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-line px-1 font-mono text-[11px] text-fg-3 group-data-[collapsed=true]/shell:hidden">
                [
              </kbd>
            </button>
          </aside>
        </div>
        <div className="flex min-h-screen min-w-0 flex-col">{children}</div>
      </div>
      {/* Toasts are app-only (actions in the shell and its pages); the root layout no longer mounts them. */}
      <ToastOutlet />
    </TooltipProvider>
  );
}
