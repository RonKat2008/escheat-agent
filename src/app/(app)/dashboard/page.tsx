import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { MarkVisited } from "@/components/motion";
import "@/components/motion/motion.css";
import { askLinkFor } from "@/lib/ask/ask-link";
import { DEADLINES_PROMPT, EXPOSURE_PROMPT } from "@/lib/ask/starters";
import { chatAvailability } from "@/lib/chat/agent";
import { BriefRow, DueNext, LoopSlot, MoreDetail, RecentActivity, WhereTheMoneyIs, type AskTarget } from "./below";
import { MoneyFlowSection } from "./flow-section";
import { HeroExposure } from "./hero";
import { AuditInterest, DeadlinesPanel, FeaturedItem, StatusPanel } from "./sections";
import { DashboardSkeleton } from "./skeletons";
import { NavHold } from "@/components/shell/NavHold";

export const metadata: Metadata = { title: "Dashboard" };

/** A "Do it in Ask" target, only when Ask answers `prompt` today (never one that would reply "no recorded answer"). */
function askTarget(prompt: string): AskTarget | null {
  const href = askLinkFor(prompt, chatAvailability());
  return href ? { href, prompt } : null;
}

/**
 * The calm, view-only overview (docs/ASK-MODE.md slice 5): the stage, then two sections (where the money is, what is
 * due next) and one closed "More detail" fold holding everything denser. Reads env (chat availability) per request.
 */
async function Overview() {
  await connection();
  const deadlines = askTarget(DEADLINES_PROMPT);
  return (
    <>
      <HeroExposure askDeadlines={deadlines?.href ?? null} />
      <BriefRow />
      <WhereTheMoneyIs ask={askTarget(EXPOSURE_PROMPT)} />
      <DueNext deadlines={<DeadlinesPanel />} ask={deadlines} />
      <MoreDetail>
        <LoopSlot />
        <RecentActivity className="mt-14" />
        <MoneyFlowSection />
        <div className="mt-14 grid gap-x-12 gap-y-12 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-5">
            <StatusPanel />
          </div>
          <div className="min-w-0 lg:col-span-7">
            <AuditInterest />
          </div>
          <div className="min-w-0 lg:col-span-12">
            <FeaturedItem />
          </div>
        </div>
      </MoreDetail>
    </>
  );
}

/**
 * DESIGN-V4 §7 + ASK-MODE slice 5: a calm landing page. The hero stage fills the first viewport (headline, deadline
 * panel, CTA, feature strip). Below it, the CFO brief row and two sections, one idea each: where the money is (the 3D
 * Money Map) and what is due next. Everything else is folded under "More detail" or lives on its own page.
 *
 * One Suspense boundary for the whole page (CLS): sections share one cached read (./data.ts), so they resolve together
 * and replace a skeleton that is taller than the viewport. Nothing that was visible moves when content arrives.
 */
export default function DashboardPage() {
  return (
    // sr-only tables cannot shrink below their unwrapped text and are absolutely positioned, so every SrTable host is
    // `relative overflow-x-clip` (its containing block clips it); this root is the same guard for anything else.
    <div className="relative min-w-0 overflow-x-clip">
      <MarkVisited id="dashboard" />
      {/* V4: the hero stage is the first thing under the top bar, so the page title is for assistive tech only. */}
      <h1 className="sr-only text-fg-1">Dashboard</h1>
      <Suspense fallback={<NavHold><DashboardSkeleton /></NavHold>}>
        <Overview />
      </Suspense>
    </div>
  );
}
