import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Escheat Agent", template: "%s | Escheat Agent" },
  description: "Unclaimed-property compliance agent. Prototype.",
};
export const viewport: Viewport = { themeColor: "#0B1220", colorScheme: "dark" };

/** Bare root: fonts, theme, tooltips and toasts. The app chrome lives in (app)/layout.tsx so that
 *  /replica/**, /owner/** and /login render without it. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} dark h-full antialiased`}>
      <body className="min-h-full">
        <TooltipProvider delay={200}>
          {children}
          <Toaster theme="dark" />
        </TooltipProvider>
      </body>
    </html>
  );
}
