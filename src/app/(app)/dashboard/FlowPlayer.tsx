"use client";

import { useHeroOnce } from "@/components/motion";
import { MoneyFlowSankey, type MoneyFlowSankeyProps } from "@/components/viz/sankey/MoneyFlowSankey";

/** The Sankey's links draw left to right at 1000ms on the first visit of the session only (§6.3); final otherwise. */
export function FlowPlayer(props: Omit<MoneyFlowSankeyProps, "play">) {
  const play = useHeroOnce("dashboard-flow");
  return <MoneyFlowSankey {...props} play={play} />;
}
