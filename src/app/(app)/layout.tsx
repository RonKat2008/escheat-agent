import { Suspense } from "react";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { MotionRoot } from "@/components/motion/MotionRoot";
import { Disclaimer } from "@/components/primitives/v3";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { Brand, BrandMark } from "@/components/shell/Brand";
import { HeaderData, HeaderFallback, MobileNavData, SidebarData, SidebarFallback } from "@/components/shell/HeaderData";
import { LoopBar, LoopBarFallback } from "@/components/shell/LoopBar";
import { MobileNav } from "@/components/shell/MobileNav";
import { NavProgress } from "@/components/shell/NavProgress";
import { ShellFrame } from "@/components/shell/ShellFrame";
import { ShortcutsSheet } from "@/components/shell/ShortcutsSheet";
import { TourHost } from "@/components/tour/TourHost";

/**
 * App shell (DESIGN-V3 §6.0): sidebar 232px (collapsible to 56px with `[`) · top bar 48px · Loop Bar 40px · content
 * (max 1360px) · footer with the disclaimer. The shell itself never animates.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
      <MotionRoot>
        <ShellFrame
          sidebar={
            <>
              <div className="mb-4 px-2.5 group-data-[collapsed=true]/shell:px-1.5">
                <Brand />
              </div>
              <Suspense fallback={<SidebarFallback />}>
                <SidebarData />
              </Suspense>
            </>
          }
        >
          {/* Only the 48px top bar is sticky: pages pin their own sticky headers at top-12 (48px). The Loop Bar sits
              directly under it and scrolls with the page. */}
          <header className="sticky top-0 z-30 bg-ink-0/85 backdrop-blur-md">
            <div className="flex h-12 items-center gap-2 border-b border-line bg-ink-1/60 px-3 sm:gap-3 sm:px-6 lg:px-8">
              <Suspense fallback={<MobileNav />}>
                <MobileNavData />
              </Suspense>
              <span className="lg:hidden">
                <BrandMark />
              </span>
              <Suspense fallback={<HeaderFallback />}>
                <HeaderData />
              </Suspense>
            </div>
          </header>
          <Suspense fallback={<LoopBarFallback />}>
            <LoopBar />
          </Suspense>
          <main id="main" className="mx-auto w-full max-w-[1360px] flex-1 px-4 pt-7 pb-12 sm:px-6 lg:px-8 lg:pt-9">
            {children}
          </main>
          <footer className="border-t border-line px-4 py-4 sm:px-6 lg:px-8">
            <Disclaimer className="mx-auto max-w-[1360px]" />
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
