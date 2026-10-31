import { Suspense } from "react";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { Brand, BrandMark } from "@/components/shell/Brand";
import { HeaderData, HeaderFallback, SidebarData, SidebarFallback } from "@/components/shell/HeaderData";
import { MobileNav } from "@/components/shell/MobileNav";
import { DISCLAIMER } from "@/lib/disclaimer";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
      <div className="min-h-screen bg-ink-0 lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-ink-3 focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        {/* The grid column carries the background/border so it spans the full page height; the inner nav stays pinned. */}
        <div className="hidden border-r border-line bg-ink-1 lg:block">
          <aside className="sticky top-0 flex h-dvh flex-col px-3 pt-4 pb-3">
            <div className="mb-4 px-2.5">
              <Brand />
            </div>
            <Suspense fallback={<SidebarFallback />}>
              <SidebarData />
            </Suspense>
          </aside>
        </div>
        <div className="flex min-h-screen min-w-0 flex-col">
          <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-line bg-ink-0/85 px-3 backdrop-blur-md sm:gap-3 sm:px-6">
            <MobileNav />
            <span className="lg:hidden">
              <BrandMark />
            </span>
            <Suspense fallback={<HeaderFallback />}>
              <HeaderData />
            </Suspense>
          </header>
          <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 pt-7 pb-12 sm:px-6 lg:px-8 lg:pt-9">
            {children}
          </main>
          <footer className="border-t border-line px-4 py-4 sm:px-6 lg:px-8">
            <p className="mx-auto max-w-[1280px] text-xs text-fg-3">{DISCLAIMER}</p>
          </footer>
        </div>
        <CommandPalette />
      </div>
    </NuqsAdapter>
  );
}
