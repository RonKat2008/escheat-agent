import Link from "next/link";
import { notFound } from "next/navigation";
import { PORTAL_SLUGS, parsePortal, portalHref } from "@/lib/replica/portal";

// The replica is a mock gov site; instant navigation is not a goal, and a blocking
// params check lets an invalid portal slug return a real 404.
export const instant = false;

export function generateStaticParams() {
  return PORTAL_SLUGS.map((portal) => ({ portal }));
}

export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ portal: string }>;
}) {
  const portal = parsePortal((await params).portal);
  if (!portal) notFound();
  const holder = portal.kind === "holder";
  return (
    <>
      <header className="rp-header">
        <div className="rp-header-inner">
          <div className="rp-seal" aria-hidden="true">STATE SEAL PLACEHOLDER</div>
          <div>
            <p className="rp-title">{portal.agencyTitle}</p>
            <p className="rp-subtitle">
              {holder ? "Holder Reporting (file a report)" : "Search for unclaimed property"} - sample system
            </p>
          </div>
        </div>
      </header>
      <nav className="rp-nav" aria-label="Portal navigation">
        <ul>
          {holder ? (
            <>
              <li><Link href={portalHref(portal)}>Holder login</Link></li>
              <li><Link href={portalHref(portal, "dashboard")}>Dashboard</Link></li>
              <li><Link href={portalHref(portal, "upload")}>Upload a report file</Link></li>
            </>
          ) : (
            <li><Link href={portalHref(portal)}>Search unclaimed property</Link></li>
          )}
        </ul>
      </nav>
      <main className="rp-content" id="main">
        {children}
      </main>
    </>
  );
}
