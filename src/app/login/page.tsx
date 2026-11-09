import type { Metadata } from "next";
import { Suspense } from "react";
import { Disclaimer, InstrumentLabel } from "@/components/primitives";
import { Brand } from "@/components/shell/Brand";
import { safeNextPath } from "./gate";
import { LoginForm } from "./LoginForm";
import { VaultSilhouette } from "./VaultSilhouette";

export const metadata: Metadata = { title: "Sign in" };

async function LoginFormWithNext({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <LoginForm next={safeNextPath(Array.isArray(next) ? next[0] : next)} />;
}

/**
 * LoginSplit (DESIGN-V3 §6.2). At ≥1024px: left is the vault floor with the static Money Map outline and the wordmark;
 * right is the 360px passcode form with the disclaimer under it. Below 1024px: wordmark, then the form.
 */
// cacheComponents is on: runtime data (searchParams) must sit inside Suspense.
export default function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(480px,40%)]" data-testid="login-split">
      <section aria-label="Escheat Agent" className="relative flex min-w-0 flex-col overflow-hidden px-6 pt-6 pb-8 sm:px-10 lg:px-16 lg:py-10">
        <Brand />
        <div className="mt-8 max-w-xl lg:mt-auto">
          <InstrumentLabel as="p">Unclaimed property compliance</InstrumentLabel>
          <p className="type-display mt-4 text-[clamp(2.25rem,1.2rem+3.6vw,4.5rem)] leading-[1] tracking-[-0.045em]">
            Every uncashed check is a <span className="text-pink-300">legal clock.</span>
          </p>
          <p className="mt-3 max-w-md text-[15px] leading-6 text-fg-2">
            Finds stale checks, drafts the due-diligence letters, and prepares state filings for your approval.
          </p>
        </div>
        <div className="mt-6 hidden w-full max-w-3xl lg:mb-auto lg:block" data-testid="login-art">
          <VaultSilhouette />
        </div>
      </section>
      <main id="main" className="flex min-w-0 flex-col px-4 py-8 sm:px-10 lg:py-10 lg:pr-12 lg:pl-0">
        <div className="login-rise glass mx-auto my-auto w-full max-w-[424px] rounded-[28px] px-5 py-8 sm:px-8 sm:py-10">
        <div className="mx-auto w-full max-w-[360px]" data-testid="login-form-panel">
          <h1 id="login-heading" className="type-display text-[32px]">
            Enter passcode
          </h1>
          <p className="mt-2 mb-6 text-sm text-fg-2">This prototype is passcode protected. Ask the demo operator for the code.</p>
          <Suspense fallback={<LoginForm next="/dashboard" />}>
            <LoginFormWithNext searchParams={searchParams} />
          </Suspense>
          <Disclaimer className="mt-8" />
        </div>
        </div>
      </main>
    </div>
  );
}
