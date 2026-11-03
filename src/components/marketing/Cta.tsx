import Link from "next/link";
import { ArrowRight } from "lucide-react";

/** Primary CTA. "Open the demo" goes to the gated app, which redirects to the passcode login when signed out. */
export function DemoButton({ children = "Open the demo", className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <Link href="/dashboard" prefetch={false} className={`mkt-btn mkt-btn-primary ${className}`}>
      {children}
      <ArrowRight aria-hidden className="mkt-btn-arrow" size={16} strokeWidth={1.75} />
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
