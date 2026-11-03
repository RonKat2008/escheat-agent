import type { Metadata } from "next";
import { LenisScroll } from "@/components/marketing/LenisScroll";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteNav } from "@/components/marketing/SiteNav";
import "./marketing.css";
import "./marketing-sections.css";

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
    images: [{ url: "/marketing/vault-poster.webp", width: 1600, height: 1000, alt: "The Vault: ledger items flowing as light toward CA, TX and DE, stopping at pink approval gates." }],
  },
  twitter: { card: "summary_large_image", title: "Escheat Agent", description: "Unclaimed-property compliance as an autonomous, auditable agent." },
};

/**
 * Public marketing site. Static copy only: no database access, no company data. Two font families (Geist, Geist Mono)
 * come from the root layout; Instrument Serif is gone (DESIGN-V3 §1.3). No motion library here: reveals and line draws
 * are CSS (marketing.css), so the landing stays under its 250 KB gz JS budget (§8 item 10). The root layout's inline
 * script applies the in-app Reduce motion preference (html[data-motion]) before first paint.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mkt-root">
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
