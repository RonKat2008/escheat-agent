"use client";

import { useId, useState, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type CardState = "loading" | "not-configured" | "disconnected" | "connected";

const STATE_LABEL: Record<CardState, string> = {
  loading: "Checking",
  "not-configured": "Not configured",
  disconnected: "Not connected",
  connected: "Connected",
};

/**
 * One integration as a list row (docs/DESIGN-RESEARCH.md §6.10): name + one-line description on the left, honest status,
 * action on the right. Unconfigured rows disclose the missing env vars in a code well behind a secondary "Configure" button.
 */
export function IntegrationRow({
  title,
  description,
  state,
  envVars,
  detail,
  actions,
  children,
}: {
  title: string;
  description: string;
  state?: CardState;
  /** env vars to add, shown only in the not-configured state */
  envVars?: string[];
  /** extra status text next to a Connected check (e.g. realm id) */
  detail?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wellId = useId();
  const notConfigured = state === "not-configured";
  return (
    <li className="border-b border-line py-5 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-sm font-medium text-fg-1">{title}</h3>
            {state ? (
              state === "connected" ? (
                <span className="inline-flex items-center gap-1.5 text-[13px] text-blue-400">
                  <CheckCircle2 className="size-3.5 self-center" strokeWidth={1.75} aria-hidden />
                  {STATE_LABEL.connected}
                  {detail ? <span className="text-fg-3">{detail}</span> : null}
                </span>
              ) : (
                <span className="text-[13px] text-fg-3">{STATE_LABEL[state]}</span>
              )
            ) : null}
          </div>
          <p className="mt-1 max-w-prose text-[13px] leading-5 text-fg-2">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {notConfigured ? (
            <Button variant="outline" aria-expanded={open} aria-controls={wellId} onClick={() => setOpen((o) => !o)}>
              Configure
            </Button>
          ) : (
            actions
          )}
        </div>
      </div>
      {notConfigured && open ? (
        <div id={wellId} className="es-rise mt-4 rounded-md border border-line bg-ink-1 p-3.5">
          <p className="text-[13px] text-fg-2">Add these to .env.local and restart the server.</p>
          <ul className="mt-2 space-y-1 font-mono text-xs text-fg-1">
            {envVars?.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {!notConfigured && children ? <div className="mt-3 space-y-3 text-sm">{children}</div> : null}
    </li>
  );
}
