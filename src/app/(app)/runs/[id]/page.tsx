import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { Skel } from "@/components/b/Skel";
import { PageHeader } from "@/components/primitives";
import { getDb } from "@/db/client";
import { getAgentRun } from "@/lib/queries";
import { RunDetail } from "./RunDetail";

export const metadata: Metadata = { title: "Agent run" };

async function Run({ params }: { params: Promise<{ id: string }> }) {
  await connection(); // request-time data: the run may still be live and the views read the clock
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const run = await getAgentRun(await getDb(), id);
  if (!run) notFound();
  return <RunDetail run={run} />;
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <section aria-labelledby="page-heading">
      <Link
        href="/runs"
        className="group mb-4 -ml-1 inline-flex h-7 items-center gap-1.5 rounded-[6px] px-1 text-[13px] text-fg-3 transition-colors duration-150 hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-blue-400"
      >
        <ArrowLeft className="size-3.5 transition-transform duration-150 group-hover:-translate-x-0.5" strokeWidth={1.5} aria-hidden /> All runs
      </Link>
      <Suspense
        fallback={
          <div aria-busy="true">
            <PageHeader title="Agent run" className="mb-6" />
            <Skel className="h-[66px] rounded-none" />
            <div className="mt-8 space-y-3">
              {Array.from({ length: 9 }, (_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skel className="size-7 rounded-full" />
                  <Skel className="h-3 w-20" />
                  <Skel className="h-3 flex-1" style={{ maxWidth: `${40 + ((i * 17) % 40)}%` }} />
                  <Skel className="ml-auto h-3 w-10" />
                </div>
              ))}
            </div>
          </div>
        }
      >
        <Run params={params} />
      </Suspense>
    </section>
  );
}
