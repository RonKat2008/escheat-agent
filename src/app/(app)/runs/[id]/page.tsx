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
      <Link href="/runs" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> All runs
      </Link>
      <Suspense
        fallback={
          <div aria-busy="true">
            <PageHeader title="Agent run" />
            <Skel className="h-[420px] rounded-[14px]" />
          </div>
        }
      >
        <Run params={params} />
      </Suspense>
    </section>
  );
}
