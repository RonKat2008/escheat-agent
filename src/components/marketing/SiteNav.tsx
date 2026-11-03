import Link from "next/link";
import { BrandMark } from "@/components/shell/Brand";
import { DemoButton } from "./Cta";
import { MobileMenu } from "./MobileMenu";

export function SiteNav() {
  return (
    <header className="mkt-nav">
      <div className="mkt-nav-inner">
        <Link href="/" className="mkt-brand" aria-label="Escheat Agent, home">
          <BrandMark size={18} />
          Escheat Agent
        </Link>
        <nav aria-label="Main navigation" className="mkt-nav-links">
          <Link href="/how-it-works">How it works</Link>
          <Link href="/security">Security</Link>
        </nav>
        <span className="mkt-synth" title="Every company, check and dollar figure on this site is synthetic.">
          Synthetic data
        </span>
        <DemoButton className="mkt-btn-sm mkt-nav-cta" />
        <MobileMenu />
      </div>
    </header>
  );
}
