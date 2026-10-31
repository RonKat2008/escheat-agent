import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { LenisScroll } from "@/components/marketing/LenisScroll";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteNav } from "@/components/marketing/SiteNav";
import "./marketing.css";
import "./marketing-sections.css";

const sans = Geist({ variable: "--font-mkt-sans", subsets: ["latin"], display: "swap" });
const mono = Geist_Mono({ variable: "--font-mkt-mono", subsets: ["latin"], display: "swap" });
const display = Instrument_Serif({ variable: "--font-display", subsets: ["latin"], weight: "400", style: ["italic"], display: "swap" });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Escheat Agent: unclaimed-property compliance on autopilot", template: "%s | Escheat Agent" },
  description:
    "An autonomous, auditable agent that finds stale checks, applies sourced state rules, reaches owners and files unclaimed-property reports, pausing for your approval before anything irreversible.",
  openGraph: {
    type: "website",
    siteName: "Escheat Agent",
    title: "Every uncashed check is a legal clock. Escheat Agent watches all of them.",
    description: "Unclaimed-property compliance as an autonomous, auditable agent. The law is code, every irreversible step needs your approval.",
  },
  twitter: { card: "summary_large_image", title: "Escheat Agent", description: "Unclaimed-property compliance as an autonomous, auditable agent." },
};

/** Public marketing site. Static copy only: no database access, no company data. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`mkt-root ${sans.variable} ${mono.variable} ${display.variable}`}>
      <a href="#main" className="mkt-skip">
        Skip to content
      </a>
      <LenisScroll />
      <SiteNav />
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
