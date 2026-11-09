import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { Skel } from "@/components/b/Skel";
import { PageHeader } from "@/components/primitives";
import { CLOSE_OUT_STATES, isCloseOutState } from "@/lib/close-out/derive";
import { buildRunner } from "@/lib/close-out/runner";
import { getCtx } from "@/lib/ui/ctx";
import { CloseOutRunner } from "./CloseOutRunner";
import { NavHold } from "@/components/shell/NavHold";

export const metadata: Metadata = { title: "Close-out runner" };

async function Runner({ params }: { params: Promise<{ state: string }> }) {
  const st = (await params).state.toUpperCase();
  if (!isCloseOutState(st)) notFound();
  const { db, companyId } = await getCtx();
  const runner = await buildRunner(db, companyId, st);
  return (
    <>
      <PageHeader
        eyebrow="Close-out runner"
        title={`Close out ${CLOSE_OUT_STATES[st]}`}
        description={`Every step of the ${st} cycle in order: blue buttons run reversible work, pink steps need you, and filing goes to the replica ${st} portal only.`}
      />
      <CloseOutRunner initial={runner} />
    </>
  );
}

export default function Page({ params }: { params: Promise<{ state: string }> }) {
  return (
    <section aria-labelledby="page-heading">
      <Link
        href="/reports"
        className="group mb-4 -ml-1 inline-flex h-7 items-center gap-1.5 rounded-[6px] px-1 text-[13px] text-fg-3 transition-colors duration-150 hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-blue-400"
      >
        <ArrowLeft className="size-3.5 transition-transform duration-150 group-hover:-translate-x-0.5" strokeWidth={1.5} aria-hidden /> Reports
      </Link>
      <Suspense
        fallback={
          <NavHold>
            <div role="status" aria-busy="true" aria-label="Loading the close-out runner" className="space-y-6">
              <Skel className="h-8 w-1/2" />
              <Skel className="h-3 w-full" />
              {Array.from({ length: 8 }, (_, i) => (
                <Skel key={i} className="h-16" />
              ))}
            </div>
          </NavHold>
        }
      >
        <Runner params={params} />
      </Suspense>
    </section>
  );
}
