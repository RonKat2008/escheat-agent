"use client";

import { CircleCheck, CircleDashed, CircleDot, PlugZap } from "lucide-react";
import type { IntegrationCardRow, IntegrationsCardUi } from "@/lib/chat/ui-types";
import { cn } from "@/lib/utils";
import { AskButton } from "../parts";
import { ActionCardFrame, Code, GhostLink } from "./frame";

const STATE_COPY: Record<IntegrationCardRow["state"], { label: string; icon: typeof CircleCheck; tone: string }> = {
  configured: { label: "Configured", icon: CircleCheck, tone: "text-blue-400" },
  partial: { label: "Partly configured", icon: CircleDot, tone: "text-fg-2" },
  "not configured": { label: "Not configured", icon: CircleDashed, tone: "text-fg-3" },
};

function Row({ row }: { row: IntegrationCardRow }) {
  const s = STATE_COPY[row.state];
  const Icon = s.icon;
  return (
    <li className="space-y-1.5 px-4 py-3 sm:px-5" data-testid="integration-row" data-integration={row.id} data-state={row.state}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-[13px] font-medium text-fg-1">{row.label}</p>
        <p className={cn("inline-flex items-center gap-1 text-xs", s.tone)} data-testid="integration-state">
          <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
          {s.label}
        </p>
      </div>
      {row.state === "configured" ? (
        <p className="text-xs text-fg-3">
          Set: {row.required.map((n, i) => (
            <span key={n}>
              {i > 0 ? ", " : ""}
              <Code>{n}</Code>
            </span>
          ))}
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-pretty text-fg-2">
          To turn on, set{" "}
          {row.missing.map((n, i) => (
            <span key={n}>
              {i > 0 ? (i === row.missing.length - 1 ? " and " : ", ") : ""}
              <Code>{n}</Code>
            </span>
          ))}{" "}
          in <Code>.env.local</Code>. Until then: {row.fallback}.
        </p>
      )}
    </li>
  );
}

/**
 * "Set up integrations" (docs/ASK-MODE.md §2.1): each optional integration with an honest status and the env var NAMES
 * that turn it on. Never a value, never a key-entry field, and no connect button: QuickBooks and Plaid connect from
 * Settings only after their sandbox keys are set, and nothing here calls a real service.
 */
export function IntegrationsCardView({ rows }: IntegrationsCardUi["props"]) {
  const configured = rows.filter((r) => r.state === "configured").length;
  return (
    <ActionCardFrame
      testId="view-integrations-card"
      icon={<PlugZap />}
      eyebrow="Set up integrations"
      title="Optional integrations"
      meta={`${configured} of ${rows.length} configured`}
      footer={
        <>
          <GhostLink href="/settings/integrations">Open Integrations</GhostLink>
          <AskButton question="Get started">Getting started checklist</AskButton>
        </>
      }
    >
      <ol className="space-y-1 px-4 py-3 text-[13px] text-fg-2 sm:px-5" aria-label="How to turn one on" data-testid="integrations-steps">
        <li>
          <span className="num mr-2 text-fg-3">1</span>Copy the names you need from <Code>.env.example</Code> into <Code>.env.local</Code> with your own sandbox or test values.
        </li>
        <li>
          <span className="num mr-2 text-fg-3">2</span>Restart <Code>pnpm dev</Code>.
        </li>
        <li>
          <span className="num mr-2 text-fg-3">3</span>Run <Code>pnpm run doctor</Code>: it lists every name as set or not set, never a value.
        </li>
      </ol>
      <ul className="divide-y divide-line border-t border-line" aria-label="Integrations">
        {rows.map((r) => (
          <Row key={r.id} row={r} />
        ))}
      </ul>
    </ActionCardFrame>
  );
}
