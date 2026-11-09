import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ChatApp } from "@/components/chat/ChatApp";
import { NavHold } from "@/components/shell/NavHold";
import { MoneyMap } from "@/components/viz/money-map/MoneyMap";
import { askStarters } from "@/lib/ask/starters";
import { loadStarterState } from "@/lib/ask/starter-data";
import { chatAvailability, chatModel } from "@/lib/chat/agent";
import { formatUSD } from "@/lib/money";
import { loadDashboard } from "../dashboard/data";
import { AskSkeleton } from "./skeleton";

export const metadata: Metadata = { title: "Ask" };

/**
 * "Where the money is" (docs/ASK-MODE.md §4): the dashboard's Money Map in its compact CSS tilt, from the same cached
 * read (dashboard/data.ts). The label is the same total get_exposure returns; the SrTable keeps every row.
 */
async function MapPreview() {
  const d = await loadDashboard();
  if (d.mapStates.length === 0) return null;
  const states = d.exposure.byState.length;
  return (
    <>
      <p className="mt-1 text-[13px] text-fg-2" data-testid="ask-map-total">
        <span className="num text-[22px] font-light tracking-[-0.02em] text-fg-1">{d.exposure.total.formatted}</span>{" "}
        across <span className="num">{states}</span> {states === 1 ? "state" : "states"}
      </p>
      <div className="mt-2">
        <MoneyMap
          compact
          title="Where the money is"
          states={d.mapStates}
          hqState={d.company.incorporationState}
          recovered={d.flow.recoveredByState.map((r) => ({ ...r, formatted: formatUSD(r.cents) }))}
        />
      </div>
    </>
  );
}

/** Reads env at request time (keys can change between deploys) and the starter state, so it renders dynamically. */
async function AskWithData() {
  await connection();
  const starters = askStarters(await loadStarterState());
  return <ChatApp variant="ask" availability={chatAvailability()} model={chatModel()} starters={starters} mapPreview={<MapPreview />} />;
}

/** Ask mode (docs/ASK-MODE.md §1): the default landing. One chat agent, answers rendered as the existing chat cards. */
export default function AskPage() {
  return (
    <Suspense
      fallback={
        <NavHold>
          <AskSkeleton />
        </NavHold>
      }
    >
      <AskWithData />
    </Suspense>
  );
}
