import { Suspense } from "react";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { MotionRoot } from "@/components/motion/MotionRoot";
import { Disclaimer } from "@/components/primitives/v3";
import { SyntheticChip } from "@/components/primitives/badges";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { HeaderData, HeaderFallback, SidebarData, SidebarFallback } from "@/components/shell/HeaderData";
import { HideInAsk } from "@/components/shell/HideInAsk";
import { LoopBar, LoopBarFallback } from "@/components/shell/LoopBar";
import { NavProgress } from "@/components/shell/NavProgress";
import { ShellFrame } from "@/components/shell/ShellFrame";
import { ShortcutsSheet } from "@/components/shell/ShortcutsSheet";
import { TourHost } from "@/components/tour/TourHost";

/**
 * App shell (DESIGN-V4 §5): a floating glass top bar (brand · centred pill nav · round glass tools and the ☰ menu
 * sheet, which holds every page grouped Work / Books / Setup / Agents) · glass Loop Bar (below the hero on the
 * dashboard) · content (max 1360px) · footer with the disclaimer, all over the fixed navy/coral backdrop. No rail. The
 * shell itself never animates.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
      <MotionRoot>
        <ShellFrame
          header={
            // V4 §5: a floating glass bar, 42px tall, 6px from the top, so the sticky header is still 48px and pages can
            // keep pinning their own sticky headers at top-12. Brand left, pill nav centred, round glass tools right.
            <header className="sticky top-0 z-30 px-2 pt-1.5 sm:px-3">
              <div
                data-testid="top-bar"
                className="glass-strong grid h-[42px] grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-full pr-1 pl-3.5 lg:grid-cols-[auto_1fr_auto] xl:grid-cols-[1fr_auto_1fr]"
              >
                {/* Brand + the Ask / Dashboard mode switch (ASK-MODE §1.2) · pill nav · tools: all three columns in one boundary. */}
                <Suspense fallback={<HeaderFallback />}>
                  <HeaderData />
                </Suspense>
              </div>
            </header>
          }
          sidebar={
            <Suspense fallback={<SidebarFallback />}>
              <SidebarData />
            </Suspense>
          }
        >
          {/* The Loop Bar sits directly under the top bar and scrolls with the page. Ask mode has none (ASK-MODE §1). */}
          <HideInAsk>
            <Suspense fallback={<LoopBarFallback />}>
              <LoopBar />
            </Suspense>
          </HideInAsk>
          <main id="main" className="mx-auto w-full max-w-[1360px] flex-1 px-4 pt-7 pb-12 sm:px-6 lg:px-8">
            {children}
          </main>
          <footer className="border-t border-line px-4 py-5 sm:px-6 lg:px-8">
            <div className="mx-auto flex max-w-[1360px] flex-wrap items-center gap-x-3 gap-y-2">
              {/* The top bar shows its chip from 1280px only (the mode switch and pill nav need the room); the footer carries it below. */}
              <SyntheticChip className="xl:hidden" />
              <Disclaimer />
            </div>
          </footer>
        </ShellFrame>
        {/* Top hairline while a client navigation is in flight; also marks navigations for the skeleton hold. */}
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <CommandPalette />
        <ShortcutsSheet />
        {/* Judge tour: reads ?tour=N; its overlay is a lazy chunk loaded only while a tour is open. */}
        <Suspense fallback={null}>
          <TourHost />
        </Suspense>
      </MotionRoot>
    </NuqsAdapter>
  );
}
