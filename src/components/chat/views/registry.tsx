"use client";

import type { UiPayload } from "@/lib/chat/ui-types";
import { ApprovalCardView } from "./ApprovalCardView";
import { ApprovalsView } from "./ApprovalsView";
import { DeadlinesView } from "./DeadlinesView";
import { ExposureView } from "./ExposureView";
import { InterestView } from "./InterestView";
import { ItemsTableView } from "./ItemsTableView";
import { ItemTimelineView } from "./ItemTimelineView";
import { RecoveriesView, ReportsView, ReportView } from "./ReportViews";
import { RulesView } from "./RulesView";
import { AgentRunView, ClockView, ErrorView, LinkCardView, RunsView } from "./SystemViews";

/** The generative-UI registry: one component per fixed `ui.kind`. Unknown kinds render nothing. */
export function ViewRenderer({ ui }: { ui: UiPayload }) {
  switch (ui.kind) {
    case "exposure":
      return <ExposureView {...ui.props} />;
    case "items":
      return <ItemsTableView {...ui.props} />;
    case "item_timeline":
      return <ItemTimelineView {...ui.props} />;
    case "deadlines":
      return <DeadlinesView {...ui.props} />;
    case "interest":
      return <InterestView {...ui.props} />;
    case "approvals":
      return <ApprovalsView {...ui.props} />;
    case "approval_card":
      return <ApprovalCardView {...ui.props} />;
    case "rules":
      return <RulesView {...ui.props} />;
    case "reports":
      return <ReportsView {...ui.props} />;
    case "report":
      return <ReportView {...ui.props} />;
    case "recoveries":
      return <RecoveriesView {...ui.props} />;
    case "runs":
      return <RunsView {...ui.props} />;
    case "agent_run":
      return <AgentRunView {...ui.props} />;
    case "clock":
      return <ClockView {...ui.props} />;
    case "link":
      return <LinkCardView {...ui.props} />;
    case "error":
      return <ErrorView {...ui.props} />;
    default:
      return null;
  }
}
