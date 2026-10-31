import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Escheat Agent", template: "%s | Escheat Agent" },
  description: "Unclaimed-property compliance agent. Prototype.",
};
export const viewport: Viewport = { themeColor: "#000000", colorScheme: "dark" };

/** Bare root: fonts, theme, tooltips and toasts. The app chrome lives in (app)/layout.tsx so that
 *  /replica/**, /owner/** and /login render without it. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} dark h-full antialiased`}>
      <body className="min-h-full">
        <TooltipProvider delay={200}>
          {children}
          <Toaster theme="dark" />
        </TooltipProvider>
      </body>
    </html>
  );
}
