"use client";

import type { UiPayload } from "@/lib/chat/ui-types";
import { ApprovalCardView } from "./ApprovalCardView";
import { ApprovalsView } from "./ApprovalsView";
import { ClosePlanView } from "./ClosePlanView";
import { DeadlinesView } from "./DeadlinesView";
import { ExposureView } from "./ExposureView";
import { ForecastView } from "./ForecastView";
import { InterestView } from "./InterestView";
import { ItemsTableView } from "./ItemsTableView";
import { ItemTimelineView } from "./ItemTimelineView";
import { RecoveriesView, ReportsView, ReportView } from "./ReportViews";
import { RulesView } from "./RulesView";
import { AgentRunView, ClockView, ErrorView, LinkCardView, RunsView } from "./SystemViews";
import { GettingStartedView } from "./ask/GettingStartedView";
import { ImportCardView } from "./ask/ImportCardView";
import { IntegrationsCardView } from "./ask/IntegrationsCardView";
import { OverdueView } from "./ask/OverdueView";
import { DraftOutreachView } from "./ask/DraftOutreachView";
import { FilingCardView } from "./ask/FilingCardView";
import { PeriodCloseView } from "./ask/PeriodCloseView";
import { ReviewApprovalsView } from "./ask/ReviewApprovalsView";

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
    case "forecast":
      return <ForecastView {...ui.props} />;
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
    case "close_plan":
      return <ClosePlanView {...ui.props} />;
    case "import_card":
      return <ImportCardView {...ui.props} />;
    case "integrations_card":
      return <IntegrationsCardView {...ui.props} />;
    case "overdue":
      return <OverdueView {...ui.props} />;
    case "getting_started":
      return <GettingStartedView {...ui.props} />;
    case "approvals_review":
      return <ReviewApprovalsView {...ui.props} />;
    case "outreach_drafts":
      return <DraftOutreachView {...ui.props} />;
    case "period_close":
      return <PeriodCloseView {...ui.props} />;
    case "filing":
      return <FilingCardView {...ui.props} />;
    case "error":
      return <ErrorView {...ui.props} />;
    default:
      return null;
  }
}
