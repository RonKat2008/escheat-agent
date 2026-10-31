import Link from "next/link";
import { DISCLAIMER } from "@/lib/disclaimer";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col px-4">
      <main className="flex flex-1 flex-col py-8">
        <div className="mx-auto my-auto w-full max-w-sm es-glow rounded-2xl border bg-surface/90 p-7">
          <p className="font-mono text-xs text-muted-foreground">404</p>
          <h1 className="mt-1 text-lg font-semibold">Page not found</h1>
          <p className="mt-2 mb-5 text-sm text-muted-foreground">That page does not exist, or it was cleared with the demo data.</p>
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-2"
          >
            Back to dashboard
          </Link>
        </div>
      </main>
      <footer className="py-4 text-center text-xs text-muted-foreground">{DISCLAIMER}</footer>
    </div>
  );
}
