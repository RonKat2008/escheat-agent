import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { findRecord, loadSearchRecords, portalHref } from "@/lib/replica/portal";
import { claimAction } from "../../../actions";
import { Money, resolvePortal } from "../../../_lib/page";

export const metadata: Metadata = { title: "Claim property" };
type Props = {
  params: Promise<{ portal: string; propertyId: string }>;
  searchParams: Promise<{ error?: string | string[] }>;
};

async function Claim({ params, searchParams }: Props) {
  const portal = await resolvePortal(params, "search");
  const { propertyId } = await params;
  const sp = await searchParams;
  const error = Array.isArray(sp.error) ? sp.error[0] : sp.error;
  const record = findRecord(portal.state, decodeURIComponent(propertyId), loadSearchRecords());
  if (!record) notFound();
  return (
    <>
      <h1>Claim this property</h1>
      <fieldset>
        <legend>Property</legend>
        <dl className="rp-dl">
          <dt>Property ID</dt><dd data-testid="claim-property-id">{record.propertyId}</dd>
          <dt>Owner name</dt><dd>{record.ownerName}</dd>
          <dt>Reported by</dt><dd>{record.reportedBy}</dd>
          <dt>Property type</dt><dd>{record.propertyType}</dd>
          <dt>Amount</dt><dd><Money cents={record.amountCents} /></dd>
        </dl>
      </fieldset>
      {error ? <div className="rp-error" role="alert" data-testid="claim-error">{error}</div> : null}
      <form action={claimAction} data-testid="claim-form">
        <input type="hidden" name="portal" value={portal.slug} />
        <input type="hidden" name="propertyId" value={record.propertyId} />
        <fieldset>
          <legend>Claimant information</legend>
          <label htmlFor="claimant-name">Claimant business name <span className="rp-req" aria-hidden="true">*</span></label>
          <input id="claimant-name" name="claimantName" type="text" required minLength={2} data-testid="claim-business-name" />
          <label htmlFor="claimant-contact">Contact (name, email or phone) <span className="rp-req" aria-hidden="true">*</span></label>
          <input id="claimant-contact" name="contact" type="text" required minLength={3} data-testid="claim-contact" />
          <p style={{ marginTop: 12 }}>
            <button type="submit" data-testid="claim-submit">Submit claim</button>
            <Link href={portalHref(portal)}>Back to search</Link>
          </p>
        </fieldset>
      </form>
    </>
  );
}

export default function Page(props: Props) {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <Claim {...props} />
    </Suspense>
  );
}
