import type { Metadata } from "next";
import { Suspense } from "react";
import { LockKeyhole } from "lucide-react";
import { safeNextPath } from "./gate";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

async function LoginFormWithNext({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <LoginForm next={safeNextPath(Array.isArray(next) ? next[0] : next)} />;
}

// cacheComponents is on: runtime data (searchParams) must sit inside Suspense.
export default function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  return (
    <div className="mx-auto my-auto w-full max-w-sm es-glow rounded-2xl border bg-surface/90 p-7 backdrop-blur">
      <div className="mb-5 flex items-center gap-2.5">
        <span aria-hidden className="es-gradient-bg grid size-8 place-items-center rounded-[10px] shadow-[0_0_20px_-4px_var(--es-bolt-glow)]"><LockKeyhole className="size-4 text-[#031019]" /></span>
        <h1 className="text-lg font-semibold tracking-tight">Enter passcode</h1>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        This prototype is passcode protected. Ask the demo operator for the code.
      </p>
      <Suspense fallback={<LoginForm next="/" />}>
        <LoginFormWithNext searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
