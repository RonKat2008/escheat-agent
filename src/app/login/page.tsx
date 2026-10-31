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
    <div className="mx-auto my-auto w-full max-w-sm rounded-2xl border border-line bg-ink-2 p-7">
      <div className="mb-5 flex items-center gap-2.5">
        <span aria-hidden className="grid size-8 place-items-center rounded-[10px] bg-blue-600"><LockKeyhole className="size-4 text-white" /></span>
        <h1 className="text-lg font-semibold tracking-tight">Enter passcode</h1>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        This prototype is passcode protected. Ask the demo operator for the code.
      </p>
      <Suspense fallback={<LoginForm next="/dashboard" />}>
        <LoginFormWithNext searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
