import type { Metadata } from "next";
import Link from "next/link";
import { DISCLAIMER } from "@/lib/disclaimer";
import "./replica.css";

export const metadata: Metadata = {
  title: { default: "[REPLICA] Unclaimed Property", template: "[REPLICA] %s" },
  robots: { index: false },
};

const BANNER = "REPLICA - NOT A REAL STATE SYSTEM. Demo environment for a hackathon prototype. Do not enter real data.";

/**
 * The root layout wraps every route in the Escheat Agent shell (sidebar, nav, dark theme).
 * The replica must not look like it, so this layout renders a full-screen fixed container
 * that covers the shell. See the report for the root-layout change that removes the need for this.
 */
export default function ReplicaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="replica-root" data-replica="true">
      <div className="rp-banner rp-banner-top" role="note" data-testid="replica-banner-top">
        {BANNER}
      </div>
      <div className="rp-main">{children}</div>
      <footer className="rp-footer">
        <p>
          Replica portal for the Escheat Agent prototype. <Link href="/">Back to Escheat Agent</Link>
        </p>
        <p data-testid="disclaimer">{DISCLAIMER}</p>
      </footer>
      <div className="rp-banner rp-banner-bottom" role="note" data-testid="replica-banner-bottom">
        {BANNER}
      </div>
    </div>
  );
}
