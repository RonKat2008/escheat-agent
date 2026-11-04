import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatDate } from "@/lib/format";
import { claimDay, getPortalDb, listFiledClaims, portalHref, replicaToday } from "@/lib/replica/portal";
import { Money, resolvePortal } from "../../_lib/page";

export const metadata: Metadata = { title: "Filed claims" };
type Props = { params: Promise<{ portal: string }>; searchParams: Promise<{ filed?: string | string[] }> };

async function Claims({ params, searchParams }: Props) {
  await connection(); // reads the database and the demo clock: render per request
  const portal = await resolvePortal(params, "search");
  const sp = await searchParams;
  const highlight = Array.isArray(sp.filed) ? sp.filed[0] : sp.filed;
  const db = await getPortalDb();
  const [claims, today] = await Promise.all([listFiledClaims(db, portal.state), replicaToday(db)]);
  return (
    <>
      <h1>Filed claims - {portal.stateName}</h1>
      <fieldset id="filed-claims" data-testid="filed-claims">
        <legend>Filed claims</legend>
        {claims.length === 0 ? (
          <p data-testid="filed-claims-empty">No claims have been filed with {portal.stateName} from this system yet.</p>
        ) : (
          <div className="rp-scroll">
            <table>
              <caption className="rp-visually-hidden">Claims filed with {portal.stateName}, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Confirmation number</th>
                  <th scope="col">Filed</th>
                  <th scope="col">Property ID</th>
                  <th scope="col" className="rp-num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id} data-testid="filed-claim-row" className={c.confirmationNumber === highlight ? "rp-hl" : undefined} aria-current={c.confirmationNumber === highlight ? "true" : undefined}>
                    <td>
                      <Link href={portalHref(portal, "claim-confirmation", c.id)} data-testid="filed-claim-confirmation">{c.confirmationNumber}</Link>
                    </td>
                    <td>{formatDate(claimDay(c, today))}</td>
                    <td>{c.propertyId}</td>
                    <td className="rp-num"><Money cents={c.amountCents} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </fieldset>
      <p><Link href={portalHref(portal)}>Search again</Link></p>
    </>
  );
}

export default function Page(props: Props) {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <Claims {...props} />
    </Suspense>
  );
}
