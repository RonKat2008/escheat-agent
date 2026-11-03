import { CircleCheck, CircleDashed, CircleDot, CircleX } from "lucide-react";
import type { DiagramNode, IntegrationSnapshot, LinkState, ServiceId } from "@/components/viz/connection-diagram/model";
import { maskEmail } from "@/components/viz/connection-diagram/model";
import { cn } from "@/lib/utils";
import { ConfigNames, TechnicalDetails } from "./TechnicalDetails";

/** Config names per service, shown only inside the Technical details disclosure (R3-14). Names, never values. */
export const SERVICE_CONFIG_NAMES: Partial<Record<ServiceId, readonly string[]>> = {
  lob: ["LOB_TEST_API_KEY (a test-mode key, starts with test_)"],
  agentmail: ["AGENTMAIL_API_KEY", "AGENTMAIL_INBOX_ID", "ALLOWED_TEST_RECIPIENTS"],
  vapi: ["VAPI_API_KEY", "VAPI_PHONE_NUMBER_ID", "VAPI_ASSISTANT_ID", "ALLOWED_TEST_PHONES"],
  anthropic: ["ANTHROPIC_API_KEY", "ESCHEAT_OFFLINE (1 = replay recorded answers)"],
  inngest: ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY"],
};

const SHAPE: Record<LinkState, { Icon: typeof CircleCheck; className: string }> = {
  live: { Icon: CircleCheck, className: "text-blue-400" },
  simulated: { Icon: CircleDot, className: "text-blue-400" },
  off: { Icon: CircleDashed, className: "text-fg-3" },
  blocked: { Icon: CircleX, className: "text-pink-400" },
};

/** Shape + label first, color second (§1.2). */
export function ServiceStatus({ node }: { node: Pick<DiagramNode, "link" | "statusLabel" | "status"> }) {
  const { Icon, className } = SHAPE[node.link];
  return (
    <span data-testid="service-status" data-status={node.status} className={cn("inline-flex items-center gap-1.5 text-[13px]", className)}>
      <Icon className="size-3.5" strokeWidth={1.5} aria-hidden />
      {node.statusLabel}
    </span>
  );
}

/** R3-16: the email recipient is explicit and labelled as a test recipient; it never silently falls back to a real inbox. */
function TestRecipient({ snapshot }: { snapshot: IntegrationSnapshot }) {
  const { testRecipient, allowlistCount } = snapshot.agentmail;
  if (!testRecipient) {
    return (
      <p className="mt-2 text-[13px] text-fg-2" data-testid="test-recipient">
        No test recipient is approved, so no email can be sent.
      </p>
    );
  }
  return (
    <div className="mt-2 rounded-md border border-line bg-ink-1 px-3 py-2" data-testid="test-recipient">
      <p className="text-[13px] text-fg-2">
        <span className="instrument-label mr-2">Test recipient</span>
        <span className="font-mono text-fg-1" data-testid="test-recipient-address">
          {maskEmail(testRecipient)}
        </span>
        {allowlistCount > 1 ? <span className="text-fg-3"> · 1 of {allowlistCount} approved</span> : null}
      </p>
      <p className="mt-1 text-xs text-fg-3">
        New email drafts are addressed to this test recipient, not to the payee. Change it on each draft; any address that is not approved is refused.
        Nothing is sent from this page.
      </p>
    </div>
  );
}

function ServiceRow({ node, snapshot }: { node: DiagramNode; snapshot: IntegrationSnapshot }) {
  const names = SERVICE_CONFIG_NAMES[node.id];
  return (
    <li className="border-b border-line py-4 first:pt-0" data-testid={`service-row-${node.id}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-medium text-fg-1">{node.name}</h3>
        <ServiceStatus node={node} />
      </div>
      <p className="mt-1 max-w-prose text-[13px] leading-5 text-fg-2">{node.note}</p>
      {node.id === "agentmail" ? <TestRecipient snapshot={snapshot} /> : null}
      {names ? (
        <TechnicalDetails>
          <ConfigNames names={names} />
        </TechnicalDetails>
      ) : null}
    </li>
  );
}

/** Outputs and engine services: read-only status rows (there is nothing to connect from here, and nothing is sent). */
export function ServiceRows({ nodes, snapshot }: { nodes: readonly DiagramNode[]; snapshot: IntegrationSnapshot }) {
  return (
    <ul>
      {nodes.map((n) => (
        <ServiceRow key={n.id} node={n} snapshot={snapshot} />
      ))}
    </ul>
  );
}
