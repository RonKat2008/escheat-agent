"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LayoutDashboard, MessagesSquare, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ASK_HREF, browserSession, DASHBOARD_HREF, modeOf, readLastDashboard, type AppMode } from "./mode";
import { markNavigationTo } from "./nav-hold";
import { ariaKeys, shortcutById } from "./shortcuts";
import { useShellPathname } from "./useShellLocation";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-400";
/** On touch the 32px-high segment grows its hit area to 44px with an invisible ::after (docs/ASK-MODE.md §1.2). */
const TOUCH_HIT = "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1.5 pointer-coarse:after:content-['']";

const MODE_KEYS = ariaKeys(shortcutById("mode-toggle")?.keys ?? ["mod+/"]);

/**
 * One segment. Below 640px the bar has no room for words next to the clock and tools, so a segment shows its icon and
 * keeps its label for assistive tech (same accessible name, same 44px-wide hit area). Same at 1024-1279px, where the
 * centred section pill nav needs the room.
 */
function Segment({ mode, current, href, icon: Icon, label, children }: { mode: AppMode; current: AppMode; href: string; icon: LucideIcon; label: string; children?: React.ReactNode }) {
  const active = mode === current;
  return (
    <li className={cn("flex rounded-full transition-[background-color] duration-150", active ? "bg-fg-1/[0.12] shadow-[inset_0_1px_0_rgb(244_237_224/0.12),0_1px_6px_-2px_rgb(3_7_20/0.5)]" : "hover:bg-fg-1/[0.06]")}>
      <Link
        href={href}
        onClick={() => markNavigationTo(href)}
        aria-current={active ? "page" : undefined}
        aria-keyshortcuts={MODE_KEYS}
        data-testid={`mode-${mode}`}
        data-active={active ? "true" : "false"}
        className={cn(
          "relative inline-flex h-8 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] max-sm:px-0 lg:max-xl:px-0 whitespace-nowrap transition-colors duration-150",
          FOCUS,
          TOUCH_HIT,
          active ? "font-medium text-fg-1" : "text-fg-2 hover:text-fg-1",
        )}
      >
        {active ? <span aria-hidden className="size-1.5 rounded-full bg-blue-300 shadow-[0_0_8px_rgb(189_206_238/0.5)] max-sm:hidden lg:max-xl:hidden" /> : null}
        <Icon aria-hidden className={cn("size-4 sm:hidden lg:max-xl:block", active ? "text-fg-1" : "text-fg-3")} strokeWidth={1.75} />
        <span className="max-sm:sr-only lg:max-xl:sr-only">{label}</span>
        {children}
      </Link>
    </li>
  );
}

/**
 * The Ask / Dashboard mode switch (docs/ASK-MODE.md §1.2): a segmented glass pill of two links (switching mode is
 * navigation, so these are links, not tabs). The Dashboard segment returns to the last Dashboard page of this session
 * and carries the coral approvals count, so nothing waiting on a person is hidden while you are in Ask.
 */
export function ModeSwitch({ waiting = 0, className }: { waiting?: number; className?: string }) {
  const pathname = useShellPathname();
  const current = modeOf(pathname);
  // SSR (and hydration) link /dashboard; the remembered page is swapped in after mount.
  const [dashboardHref, setDashboardHref] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is read after hydration
    setDashboardHref(readLastDashboard(browserSession));
  }, [pathname]);

  return (
    <nav aria-label="Mode" data-testid="mode-switch" data-ready={dashboardHref === null ? "false" : "true"} className={cn("glass-pill shrink-0 p-0.5", className)}>
      <ul className="flex items-center gap-0.5">
        <Segment mode="ask" current={current} href={ASK_HREF} icon={MessagesSquare} label="Ask" />
        <Segment mode="dashboard" current={current} href={current === "dashboard" ? DASHBOARD_HREF : (dashboardHref ?? DASHBOARD_HREF)} icon={LayoutDashboard} label="Dashboard">
          {waiting > 0 ? (
            <span
              data-testid="mode-waiting"
              className="num inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-pink-500 px-1 text-[10.5px] leading-none font-semibold text-black max-sm:absolute max-sm:-top-1 max-sm:-right-0.5 max-sm:h-3.5 max-sm:min-w-3.5 max-sm:text-[10px] lg:max-xl:absolute lg:max-xl:-top-1 lg:max-xl:-right-0.5 lg:max-xl:h-3.5 lg:max-xl:min-w-3.5 lg:max-xl:text-[10px] max-[374px]:hidden"
            >
              {waiting}
              <span className="sr-only"> waiting for approval</span>
            </span>
          ) : null}
        </Segment>
      </ul>
    </nav>
  );
}
