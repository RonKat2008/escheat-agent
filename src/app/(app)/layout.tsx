import { Suspense } from "react";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { Brand } from "@/components/shell/Brand";
import { HeaderData, HeaderFallback } from "@/components/shell/HeaderData";
import { MobileNav } from "@/components/shell/MobileNav";
import { NAV_ITEMS } from "@/components/shell/nav-items";
import { SideNav } from "@/components/shell/SideNav";
import { PrototypePill } from "@/components/primitives";
import { DISCLAIMER } from "@/lib/disclaimer";

/** Same links, no active state: shown while usePathname() resolves on dynamic routes. */
function NavFallback() {
  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
        <a key={href} href={href} className="flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm text-muted-foreground">
          <Icon className="size-4" aria-hidden />
          {label}
        </a>
      ))}
    </nav>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
    <div className="min-h-screen lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-raised focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      {/* The grid column carries the background/border so it spans the full page height; the inner nav stays pinned. */}
      <div className="hidden border-r border-border bg-surface lg:block">
        <aside className="sticky top-0 flex h-dvh flex-col p-3">
          <div className="mb-5 px-2 pt-2">
            <Brand />
          </div>
          <Suspense fallback={<NavFallback />}>
            <SideNav />
          </Suspense>
        </aside>
      </div>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur sm:gap-3 sm:px-4 lg:px-6">
          <MobileNav />
          <Suspense fallback={<HeaderFallback />}>
            <HeaderData />
          </Suspense>
          <PrototypePill className="hidden sm:inline-flex" />
        </header>
        <main id="main" className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-6 sm:px-6 lg:px-6 lg:py-8 xl:px-8">
          {children}
        </main>
        <footer className="border-t border-border px-4 py-4 text-center text-xs text-muted-foreground lg:px-8">
          <div className="mb-2 sm:hidden"><PrototypePill /></div>
          <p className="sm:inline">{DISCLAIMER}</p>
          <span className="ml-3 rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em]">SYNTHETIC DATA</span>
        </footer>
      </div>
      <CommandPalette />
    </div>
    </NuqsAdapter>
  );
}
