import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { formatDate } from "@/lib/format";
import { filedDay, getPortalDb, listFiledSubmissions, portalHref, replicaToday } from "@/lib/replica/portal";
import { logoutAction } from "../../actions";
import { requireHolderSession } from "../../_lib/auth";
import { Money, resolvePortal } from "../../_lib/page";

export const metadata: Metadata = { title: "Holder dashboard" };
type Props = { params: Promise<{ portal: string }>; searchParams: Promise<{ error?: string | string[]; filed?: string | string[] }> };

async function Dashboard({ params, searchParams }: Props) {
  const portal = await resolvePortal(params, "holder");
  const sp = await searchParams;
  const highlight = Array.isArray(sp.filed) ? sp.filed[0] : sp.filed;
  const session = await requireHolderSession(portal, highlight ? `${portalHref(portal, "dashboard")}?filed=${encodeURIComponent(highlight)}` : undefined);
  const notice = Array.isArray(sp.error) ? sp.error[0] : sp.error;
  const db = await getPortalDb();
  const [filed, today] = await Promise.all([listFiledSubmissions(db, portal.state), replicaToday(db)]);
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
      <fieldset id="filed-reports" data-testid="filed-reports">
        <legend>Filed reports</legend>
        {filed.length === 0 ? (
          <p data-testid="filed-reports-empty">No reports have been filed with {portal.stateName} from this system yet.</p>
        ) : (
          <div className="rp-scroll">
            <table>
              <caption className="rp-visually-hidden">Reports filed with {portal.stateName}, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Confirmation number</th>
                  <th scope="col">Filed</th>
                  <th scope="col" className="rp-num">Items</th>
                  <th scope="col" className="rp-num">Total</th>
                </tr>
              </thead>
              <tbody>
                {filed.map((r) => (
                  <tr key={r.id} data-testid="filed-report-row" className={r.confirmationNumber === highlight ? "rp-hl" : undefined} aria-current={r.confirmationNumber === highlight ? "true" : undefined}>
                    <td>
                      <Link href={portalHref(portal, "confirmation", r.id)} data-testid="filed-report-confirmation">{r.confirmationNumber}</Link>
                    </td>
                    <td>{formatDate(filedDay(r, today))}</td>
                    <td className="rp-num">{r.itemCount ?? 0}</td>
                    <td className="rp-num"><Money cents={r.totalCents ?? 0} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
