import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getClaim, getPortalDb, portalHref } from "@/lib/replica/portal";
import { Money, resolvePortal } from "../../../_lib/page";

export const metadata: Metadata = { title: "Claim received" };
type Props = { params: Promise<{ portal: string; id: string }> };

async function ClaimConfirmation({ params }: Props) {
  await connection(); // reads the database: render per request
  const portal = await resolvePortal(params, "search");
  const { id } = await params;
  const claim = await getClaim(await getPortalDb(), id);
  if (!claim || claim.state !== portal.state) notFound();
  return (
    <>
      <h1>Claim received</h1>
      <div className="rp-ok" role="status">
        <p>Your claim was recorded in the replica system. No funds are paid.</p>
        <p>
          Claim confirmation number:{" "}
          <span className="rp-conf" data-testid="claim-confirmation">{claim.confirmationNumber}</span>
        </p>
      </div>
      <dl className="rp-dl">
        <dt>Property ID</dt><dd>{claim.propertyId}</dd>
        <dt>Claimant</dt><dd>{claim.claimantName}</dd>
        <dt>Amount</dt><dd><Money cents={claim.amountCents} /></dd>
      </dl>
      <p><Link href={portalHref(portal)}>Search again</Link></p>
    </>
  );
}

export default function Page(props: Props) {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <ClaimConfirmation {...props} />
    </Suspense>
  );
}
