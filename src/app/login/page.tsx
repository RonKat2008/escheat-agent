import type { Metadata } from "next";
import { Suspense } from "react";
import { Money } from "@/components/primitives";
import { Brand } from "@/components/shell/Brand";
import { DISCLAIMER } from "@/lib/disclaimer";
import { safeNextPath } from "./gate";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

async function LoginFormWithNext({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <LoginForm next={safeNextPath(Array.isArray(next) ? next[0] : next)} />;
}

/** Quiet static preview of the dashboard hero figure. Synthetic demo data, labelled as such. */
function ExposurePreview() {
  return (
    <figure aria-label="Example exposure figure, synthetic demo data" className="mt-12 max-w-md border-t border-line pt-6 max-lg:hidden">
      <figcaption className="text-[13px] text-fg-3">Total exposure, demo company</figcaption>
      <p className="num mt-2 text-[56px] leading-none font-semibold tracking-[-0.03em] text-fg-1">
        <Money cents={6191500} className="[&_.money-cents]:text-[0.5em] [&_.money-cents]:tracking-normal" />
      </p>
      <p className="mt-3 text-sm text-fg-2">
        at risk across <span className="num text-fg-1">47</span> items
      </p>
      <p className="mt-6 text-xs text-fg-3">Synthetic demo data. Not a real company.</p>
    </figure>
  );
}

// cacheComponents is on: runtime data (searchParams) must sit inside Suspense.
export default function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="flex flex-col bg-ink-0 px-6 pt-6 pb-10 sm:px-10 lg:px-16 lg:py-10">
        <Brand />
        <div className="es-rise lg:my-auto lg:py-16">
          <p className="mt-10 max-w-md text-[28px] leading-[1.15] font-semibold tracking-[-0.025em] text-fg-1 lg:mt-0 lg:text-[40px]">
            Unclaimed property, filed{" "}
            <em className="pr-1 font-[family-name:var(--font-display)] text-[1.08em] font-normal tracking-[-0.01em]">on time.</em>
          </p>
          <p className="mt-4 max-w-md text-[15px] leading-6 text-fg-2">
            Finds stale checks, drafts the due-diligence letters, and prepares state filings for your approval.
          </p>
          <ExposurePreview />
        </div>
      </section>
      <section className="flex flex-col border-t border-line bg-ink-1 px-6 py-10 sm:px-10 lg:border-t-0 lg:border-l lg:px-16">
        <div className="mx-auto my-auto w-full max-w-[360px] animate-[es-rise_240ms_var(--ease-out)_both] motion-reduce:animate-none">
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-fg-1">Enter passcode</h1>
          <p className="mt-2 mb-6 text-sm text-fg-2">This prototype is passcode protected. Ask the demo operator for the code.</p>
          <Suspense fallback={<LoginForm next="/dashboard" />}>
            <LoginFormWithNext searchParams={searchParams} />
          </Suspense>
        </div>
        <p className="mx-auto mt-10 w-full max-w-[360px] text-xs text-fg-3">{DISCLAIMER}</p>
      </section>
    </div>
  );
}
