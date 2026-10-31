import Link from "next/link";
import { DISCLAIMER } from "@/lib/disclaimer";
import { Bolt } from "./Bolt";

export function SiteFooter() {
  return (
    <footer className="mkt-footer">
      <div className="mkt-wrap mkt-footer-grid">
        <div>
          <p className="mkt-brand">
            <span className="mkt-brand-mark">
              <Bolt />
            </span>
            Escheat Agent
          </p>
          <p className="mkt-footer-blurb">
            An autonomous, auditable agent for unclaimed-property compliance. It does the work. You approve every step that can&apos;t be undone.
          </p>
        </div>
        <nav aria-label="Footer navigation" className="mkt-footer-links">
          <Link href="/how-it-works">How it works</Link>
          <Link href="/security">Trust and safety</Link>
          <Link href="/dashboard">Open the demo</Link>
        </nav>
      </div>
      <div className="mkt-wrap mkt-footer-legal">
        <p className="mkt-disclaimer">{DISCLAIMER}</p>
        <p>
          Escheat Agent is a hackathon prototype (BBS x Ramp). Every company, owner, check and dollar figure on this site and in the demo is synthetic.
          It files only with replica portals and sends letters in test mode.
        </p>
      </div>
    </footer>
  );
}
