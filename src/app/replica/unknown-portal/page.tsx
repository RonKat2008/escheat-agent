import type { Metadata } from "next";
import Link from "next/link";
import { PORTAL_SLUGS } from "@/lib/replica/portal/portals";

export const metadata: Metadata = { title: "Portal not found" };

/**
 * Served with a 404 by the proxy for any /replica/<slug> that is not one of the six portals (replica-gate.ts), so the
 * [portal] layout never has to throw notFound() during instant validation. Renders inside the replica layout: both
 * REPLICA banners and the disclaimer stay.
 */
export default function UnknownPortalPage() {
  return (
    <main className="rp-content" id="main">
      <h1>Portal not found</h1>
      <p>There is no replica portal at this address. Each state has a holder portal and a search portal:</p>
      <ul>
        {PORTAL_SLUGS.map((slug) => (
          <li key={slug}>
            <Link href={`/replica/${slug}`}>/replica/{slug}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
