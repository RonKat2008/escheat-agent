import Link from "next/link";

/** Primary CTA. "Open the demo" goes to the gated app, which redirects to the passcode login. */
export function DemoButton({ children = "Open the demo", className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <Link href="/dashboard" className={`mkt-btn mkt-btn-primary ${className}`}>
      {children}
    </Link>
  );
}

export function GhostButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="mkt-btn mkt-btn-ghost">
      {children}
    </Link>
  );
}
