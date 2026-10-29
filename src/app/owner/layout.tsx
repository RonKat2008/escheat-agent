import type { Metadata } from "next";
import "./owner.css";

export const metadata: Metadata = {
  title: "Your unclaimed payment",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Public owner page: light, mobile-first, no app shell. */
export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return <div className="theme-owner">{children}</div>;
}
