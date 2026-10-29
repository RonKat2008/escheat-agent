import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { portalHref } from "@/lib/replica/portal";
import { logoutAction } from "../../actions";
import { requireHolderSession } from "../../_lib/auth";
import { resolvePortal } from "../../_lib/page";

export const metadata: Metadata = { title: "Holder dashboard" };
type Props = { params: Promise<{ portal: string }>; searchParams: Promise<{ error?: string | string[] }> };

async function Dashboard({ params, searchParams }: Props) {
  const portal = await resolvePortal(params, "holder");
  const session = await requireHolderSession(portal);
  const sp = await searchParams;
  const notice = Array.isArray(sp.error) ? sp.error[0] : sp.error;
  return (
    <>
      <h1>Holder dashboard</h1>
      <p>Signed in as <strong>{session.u}</strong>.</p>
      {notice ? <div className="rp-warn" role="status" data-testid="dashboard-notice">{notice}</div> : null}
      <fieldset>
        <legend>File a holder report</legend>
        <p>Upload a report file in the NAUPA standard electronic format (.txt) for {portal.stateName}.</p>
        <p>
          <Link className="rp-button" href={portalHref(portal, "upload")} data-testid="file-report-link">
            File a holder report
          </Link>
        </p>
      </fieldset>
      <form action={logoutAction}>
        <input type="hidden" name="portal" value={portal.slug} />
        <button type="submit" data-testid="logout">Sign out</button>
      </form>
    </>
  );
}

export default function Page(props: Props) {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <Dashboard {...props} />
    </Suspense>
  );
}
