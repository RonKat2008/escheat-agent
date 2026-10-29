import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getPortalDb, getSubmission, hasBlockingProblems, portalHref, summaryOf } from "@/lib/replica/portal";
import { approveAction, cancelAction } from "../../../actions";
import { requireHolderSession } from "../../../_lib/auth";
import { Money, resolvePortal } from "../../../_lib/page";

export const metadata: Metadata = { title: "Review submission" };
type Props = {
  params: Promise<{ portal: string; id: string }>;
  searchParams: Promise<{ error?: string | string[] }>;
};

async function Review({ params, searchParams }: Props) {
  const portal = await resolvePortal(params, "holder");
  await requireHolderSession(portal);
  const { id } = await params;
  const sp = await searchParams;
  const error = Array.isArray(sp.error) ? sp.error[0] : sp.error;
  const submission = await getSubmission(await getPortalDb(), id);
  const summary = submission ? summaryOf(submission) : null;
  if (!submission || submission.state !== portal.state || !summary) notFound();
  const blocked = hasBlockingProblems(summary);
  return (
    <>
      <h1>Review report summary</h1>
      <p>File: <strong data-testid="summary-file">{submission.fileName}</strong> (status: <span data-testid="summary-status">{submission.status}</span>)</p>
      {error ? <div className="rp-error" role="alert" data-testid="review-error">{error}</div> : null}
      <fieldset>
        <legend>Summary</legend>
        <dl className="rp-dl">
          <dt>Holder name</dt>
          <dd data-testid="summary-holder-name">{summary.holderName ?? "(not found)"}</dd>
          <dt>Report type</dt>
          <dd data-testid="summary-report-type">{summary.reportTypeLabel}</dd>
          <dt>Report year</dt>
          <dd>{summary.reportYear ?? "(not found)"}</dd>
          <dt>Number of items</dt>
          <dd data-testid="summary-item-count">{summary.itemCount}</dd>
          <dt>Total amount</dt>
          <dd data-testid="summary-total"><Money cents={summary.totalCents} /></dd>
        </dl>
        <h2>By property code</h2>
        {summary.byPropertyCode.length === 0 ? (
          <p>No property records.</p>
        ) : (
          <div className="rp-scroll">
            <table data-testid="summary-codes">
              <thead>
                <tr>
                  <th scope="col">Property code</th>
                  <th scope="col" className="rp-num">Items</th>
                  <th scope="col" className="rp-num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {summary.byPropertyCode.map((c) => (
                  <tr key={c.code} data-testid="summary-code-row">
                    <td>{c.code}</td>
                    <td className="rp-num">{c.count}</td>
                    <td className="rp-num"><Money cents={c.totalCents} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </fieldset>
      {summary.problems.length > 0 ? (
        <section aria-labelledby="problems-h" data-testid="summary-problems" className={blocked ? "rp-error" : "rp-warn"}>
          <h2 id="problems-h" style={{ marginTop: 0 }}>{blocked ? "Problems found" : "Warnings"}</h2>
          <ul>
            {summary.problems.map((p, i) => (
              <li key={i}>{p.severity === "error" ? "Error" : "Warning"}: {p.message}</li>
            ))}
          </ul>
        </section>
      ) : (
        <p data-testid="summary-no-problems">No problems were found.</p>
      )}
      {submission.status === "awaiting_approval" ? (
        <div>
          <form action={approveAction} style={{ display: "inline" }}>
            <input type="hidden" name="portal" value={portal.slug} />
            <input type="hidden" name="id" value={submission.id} />
            <button type="submit" data-testid="approve-submission">Approve submission</button>
          </form>
          <form action={cancelAction} style={{ display: "inline" }}>
            <input type="hidden" name="portal" value={portal.slug} />
            <input type="hidden" name="id" value={submission.id} />
            <button type="submit" data-testid="cancel-submission">Cancel</button>
          </form>
        </div>
      ) : submission.status === "submitted" ? (
        <p><Link href={portalHref(portal, "confirmation", submission.id)}>View confirmation</Link></p>
      ) : (
        <p>
          This submission cannot be approved ({submission.status}).{" "}
          <Link href={portalHref(portal, "upload")}>Upload a corrected file</Link>
        </p>
      )}
    </>
  );
}

export default function Page(props: Props) {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <Review {...props} />
    </Suspense>
  );
}
