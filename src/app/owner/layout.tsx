import type { Metadata } from "next";
import { MotionRoot } from "@/components/motion/MotionRoot";
import "./owner.css";

export const metadata: Metadata = {
  title: "Your unclaimed payment",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Public owner page: plain, mobile-first, no app shell, no Loop Bar (DESIGN-V3 §6.17). */
export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-owner">
      <MotionRoot>{children}</MotionRoot>
    </div>
  );
}
