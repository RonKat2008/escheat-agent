import Link from "next/link";
import { Bolt } from "./Bolt";
import { DemoButton } from "./Cta";

export function SiteNav() {
  return (
    <header className="mkt-nav">
      <div className="mkt-nav-inner">
        <Link href="/" className="mkt-brand" aria-label="Escheat Agent, home">
          <span className="mkt-brand-mark">
            <Bolt />
          </span>
          Escheat Agent
        </Link>
        <nav aria-label="Main navigation" className="mkt-nav-links">
          <Link href="/how-it-works">How it works</Link>
          <Link href="/security">Trust and safety</Link>
        </nav>
        <DemoButton className="mkt-btn-sm">Open the demo</DemoButton>
      </div>
    </header>
  );
}
