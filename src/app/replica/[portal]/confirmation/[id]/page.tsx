import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { getPortalDb, getSubmission, portalHref } from "@/lib/replica/portal";
import { requireHolderSession } from "../../../_lib/auth";
import { Money, resolvePortal } from "../../../_lib/page";

export const metadata: Metadata = { title: "Submission confirmation" };
type Props = { params: Promise<{ portal: string; id: string }> };

async function Confirmation({ params }: Props) {
  const portal = await resolvePortal(params, "holder");
  await requireHolderSession(portal);
  const { id } = await params;
  const submission = await getSubmission(await getPortalDb(), id);
  if (!submission || submission.state !== portal.state) notFound();
  if (submission.status !== "submitted" || !submission.confirmationNumber) {
    redirect(portalHref(portal, "review", submission.id));
  }
  return (
    <>
      <h1>Submission received</h1>
      <div className="rp-ok" role="status">
        <p>Your report was submitted to the replica system.</p>
        <p>
          Confirmation number:{" "}
          <span className="rp-conf" data-testid="confirmation-number">{submission.confirmationNumber}</span>
        </p>
      </div>
      <dl className="rp-dl">
        <dt>Holder</dt><dd>{submission.holderName}</dd>
        <dt>Items</dt><dd>{submission.itemCount ?? 0}</dd>
        <dt>Total</dt><dd><Money cents={submission.totalCents ?? 0} /></dd>
        <dt>Submitted</dt><dd>{submission.submittedAt?.toISOString() ?? ""}</dd>
      </dl>
      <p><Link href={portalHref(portal, "dashboard")}>Return to dashboard</Link></p>
    </>
  );
}

export default function Page(props: Props) {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <Confirmation {...props} />
    </Suspense>
  );
}
