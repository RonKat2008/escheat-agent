import type { Metadata } from "next";
import { Suspense } from "react";
import { NoticeBody, REASON_COPY, Shell } from "../OwnerShell";

export const metadata: Metadata = { title: "Link not available" };

type SearchParams = Promise<{ reason?: string | string[] }>;

/** Only a fixed reason key is read from the query; nothing from the URL is echoed. */
async function Reason({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).reason;
  const reason = Array.isArray(raw) ? raw[0] : raw;
  const copy = (reason && Object.hasOwn(REASON_COPY, reason) && REASON_COPY[reason]) || REASON_COPY.invalid!;
  return <NoticeBody title={copy.title} body={copy.body} />;
}

/**
 * Target of the proxy rewrite (src/proxy.ts) for owner links whose signature or expiry fails; the proxy serves it
 * with a real 404 or 410 status. The Shell (and its one disclaimer) sits outside the Suspense boundary.
 */
export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Shell>
      <Suspense fallback={<p className="owner-lede">Loading…</p>}>
        <Reason searchParams={searchParams} />
      </Suspense>
    </Shell>
  );
}
