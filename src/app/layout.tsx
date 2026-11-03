import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Escheat Agent", template: "%s | Escheat Agent" },
  description: "Unclaimed-property compliance agent. Prototype.",
};
// resizes-content: the on-screen keyboard shrinks the layout, so the chat composer stays above it.
export const viewport: Viewport = { themeColor: "black", colorScheme: "dark", interactiveWidget: "resizes-content" };

/**
 * Applies the in-app "Reduce motion" preference (localStorage es-motion=reduce) before first paint, so a user who
 * turned motion off never sees an entrance animation start. Static string, no user input.
 */
const MOTION_PREF_SCRIPT = `try{if(localStorage.getItem("es-motion")==="reduce")document.documentElement.dataset.motion="reduce"}catch(e){}`;

/** Bare root: fonts and theme only. The app chrome lives in (app)/layout.tsx so that /replica/**, /owner/** and /login
 *  render without it. Toasts and the tooltip delay group mount in the app shell (ShellFrame), the only place that uses
 *  them, so the landing page does not ship sonner or the tooltip provider (DESIGN-V3 §8 item 10, landing < 250 KB gz). */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} dark h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MOTION_PREF_SCRIPT }} />
      </head>
      <body className="min-h-full bg-ink-0 text-fg-1">
        {children}
      </body>
    </html>
  );
}
