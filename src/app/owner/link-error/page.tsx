import type { Metadata } from "next";
import { Suspense } from "react";
import { Notice, REASON_COPY } from "../OwnerShell";

export const metadata: Metadata = { title: "Link not available" };

type SearchParams = Promise<{ reason?: string | string[] }>;

/** Only a fixed reason key is read from the query; nothing from the URL is echoed. */
async function Reason({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).reason;
  const reason = Array.isArray(raw) ? raw[0] : raw;
  const copy = (reason && Object.hasOwn(REASON_COPY, reason) && REASON_COPY[reason]) || REASON_COPY.invalid!;
  return <Notice title={copy.title} body={copy.body} />;
}

/**
 * Target of the proxy rewrite (src/proxy.ts) for owner links whose signature or expiry fails; the proxy serves it
 * with a real 404 or 410 status.
 */
export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<Notice title="We couldn't open this link" body="Loading..." />}>
      <Reason searchParams={searchParams} />
    </Suspense>
  );
}
