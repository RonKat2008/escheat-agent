import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ShieldCheck } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SideNav } from "@/components/shell/SideNav";
import { DISCLAIMER } from "@/lib/disclaimer";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Escheat Agent", template: "%s | Escheat Agent" },
  description: "Unclaimed-property compliance agent. Prototype.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} dark h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <TooltipProvider>
          <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="size-5 text-at-risk" aria-hidden />
              <span className="font-semibold tracking-tight">Escheat Agent</span>
              <span className="rounded-full border border-at-risk/40 bg-at-risk/10 px-2 py-0.5 font-mono text-[11px] tracking-wide text-at-risk uppercase">
                Prototype
              </span>
            </div>
          </header>
          <div className="flex flex-1 flex-col md:flex-row">
            <aside className="border-b border-border bg-surface p-3 md:w-56 md:shrink-0 md:border-r md:border-b-0">
              <SideNav />
            </aside>
            <main className="flex-1 p-6">{children}</main>
          </div>
          <footer className="border-t border-border bg-surface px-4 py-3 text-center text-xs text-muted-foreground">
            {DISCLAIMER}
          </footer>
          <Toaster />
        </TooltipProvider>
      </body>
    </html>
  );
}
