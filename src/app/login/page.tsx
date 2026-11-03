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
      <section aria-label="Escheat Agent" className="relative flex min-w-0 flex-col overflow-hidden bg-ink-0 px-6 pt-6 pb-8 sm:px-10 lg:px-16 lg:py-10">
        <Brand />
        <div className="mt-8 max-w-xl lg:mt-auto">
          <InstrumentLabel as="p">Unclaimed property compliance</InstrumentLabel>
          <p className="mt-3 text-[26px] leading-[1.15] font-semibold tracking-[-0.025em] text-fg-1 lg:text-[40px]">
            Every uncashed check is a <span className="font-light text-blue-300">legal clock.</span>
          </p>
          <p className="mt-3 max-w-md text-[15px] leading-6 text-fg-2">
            Finds stale checks, drafts the due-diligence letters, and prepares state filings for your approval.
          </p>
        </div>
        <div className="mt-6 hidden w-full max-w-3xl lg:mb-auto lg:block" data-testid="login-art">
          <VaultSilhouette />
        </div>
      </section>
      <main id="main" className="flex min-w-0 flex-col border-t border-line bg-ink-1 px-6 py-10 sm:px-10 lg:border-t-0 lg:border-l lg:px-16">
        <div className="login-rise mx-auto my-auto w-full max-w-[360px]" data-testid="login-form-panel">
          <h1 id="login-heading" className="text-xl font-semibold tracking-[-0.015em] text-fg-1">
            Enter passcode
          </h1>
          <p className="mt-2 mb-6 text-sm text-fg-2">This prototype is passcode protected. Ask the demo operator for the code.</p>
          <Suspense fallback={<LoginForm next="/dashboard" />}>
            <LoginFormWithNext searchParams={searchParams} />
          </Suspense>
          <Disclaimer className="mt-8" />
        </div>
      </main>
    </div>
  );
}
