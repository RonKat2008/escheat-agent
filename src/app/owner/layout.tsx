import type { Metadata } from "next";
import "./owner.css";

export const metadata: Metadata = {
  title: "Your unclaimed payment",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * The root layout wraps every route in the dark app shell. The owner page is public and light,
 * so this renders a fixed full-screen container that covers the shell (same approach as /replica).
 */
export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return <div className="theme-owner">{children}</div>;
}
