"use client";

import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ToastOutlet } from "./ToastOutlet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { emitShell, SHELL_EVENTS, useShortcuts } from "./useShortcuts";
import type { Shortcut } from "./shortcuts";
import { markNavigationTo } from "./nav-hold";
import { browserSession, readLastDashboard, toggleTarget, writeLastDashboard } from "./mode";

const COLLAPSE_KEY = "es-sidebar";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "collapsed";
  } catch {
    return false;
  }
}

interface ShellNav {
  /** Server-rendered nav body (company chip + grouped nav with counts), shown inside the menu sheet. */
  sidebar: ReactNode;
  collapsed: boolean;
  toggle: () => void;
}

const ShellNavContext = createContext<ShellNav | null>(null);

/** The menu sheet reads the nav body and the compact (collapsed) preference from the frame. */
export function useShellNav(): ShellNav | null {
  return useContext(ShellNavContext);
}

interface ShellFrameProps {
  /** The floating glass top bar (V4): spans the full width above the content. */
  header?: ReactNode;
  /** Menu sheet body (company, grouped nav). */
  sidebar: ReactNode;
  /** Top bar + Loop Bar + main + footer. */
  children: ReactNode;
}

/**
 * The app frame (V4 §5): a floating glass top bar over full-width content (no rail; every page is in the pill nav and
 * the round menu sheet), and the one global keyboard handler. `[` still toggles the compact menu. The
 * collapsed state lives on `data-collapsed` so server-rendered nav children style themselves with
 * `group-data-[collapsed=true]/shell:` variants. It also hosts the tooltip delay group and the toast outlet, which
 * only app routes use (kept out of the root layout so the marketing pages do not load them).
 */
/** Remembers the last Dashboard-mode page (with its query) so the mode switch and mod+/ return to it (ASK-MODE §1.3). */
function LastDashboardTracker(): null {
  const pathname = usePathname();
  useEffect(() => {
    writeLastDashboard(browserSession, `${pathname}${window.location.search}`);
  }, [pathname]);
  return null;
}

export function ShellFrame({ header, sidebar, children }: ShellFrameProps) {
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
      if (s.href) {
        markNavigationTo(s.href);
        return router.push(s.href);
      }
      if (s.id === "mode-toggle") {
        const target = toggleTarget(window.location.pathname, readLastDashboard(browserSession));
        markNavigationTo(target);
        return router.push(target);
      }
      if (s.id === "palette") return emitShell(SHELL_EVENTS.togglePalette);
      if (s.id === "shortcuts") return emitShell(SHELL_EVENTS.openShortcuts);
      if (s.id === "next-action") return emitShell(SHELL_EVENTS.runNextAction);
      if (s.id === "sidebar") return toggle();
    },
    [router, toggle],
  );
  useShortcuts(onShortcut);

  const nav = useMemo(() => ({ sidebar, collapsed, toggle }), [sidebar, collapsed, toggle]);

  return (
    <ShellNavContext.Provider value={nav}>
    <TooltipProvider delay={200}>
      <div data-collapsed={collapsed ? "true" : "false"} className="group/shell min-h-screen">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-ink-3 focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        {/* usePathname() is runtime data: it must sit inside Suspense or dynamic routes cannot prerender. */}
        <Suspense fallback={null}>
          <LastDashboardTracker />
        </Suspense>
        {header}
        <div className="flex min-h-[calc(100dvh-48px)] min-w-0 flex-col">{children}</div>
      </div>
      {/* Toasts are app-only (actions in the shell and its pages); the root layout no longer mounts them. */}
      <ToastOutlet />
    </TooltipProvider>
    </ShellNavContext.Provider>
  );
}
