"use client";

import type { ReactNode } from "react";
import { CircleCheck, CircleDashed, Circle } from "lucide-react";
import { ConfigNames, TechnicalDetails } from "@/components/settings/TechnicalDetails";
import { toOperatorMessage } from "@/lib/settings/operator-copy";

export type CardState = "loading" | "not-configured" | "disconnected" | "connected";

const STATE_LABEL: Record<CardState, string> = {
  loading: "Checking",
  "not-configured": "Not configured",
  disconnected: "Not connected",
  connected: "Connected",
};

/**
 * One integration as a list row: name + one-line description on the left, honest status (shape + label), action on the
 * right. Unconfigured rows say so in plain words; the config names live only in a collapsed "Technical details"
 * disclosure (R3-14).
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
  /** config names, shown only inside the Technical details disclosure */
  envVars?: string[];
  /** extra status text next to a Connected check (e.g. realm id) */
  detail?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
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
                  <CircleCheck className="size-3.5 self-center" strokeWidth={1.5} aria-hidden />
                  {STATE_LABEL.connected}
                  {detail ? <span className="text-fg-3">{detail}</span> : null}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[13px] text-fg-3">
                  {state === "not-configured" ? (
                    <CircleDashed className="size-3.5 self-center" strokeWidth={1.5} aria-hidden />
                  ) : (
                    <Circle className="size-3.5 self-center" strokeWidth={1.5} aria-hidden />
                  )}
                  {STATE_LABEL[state]}
                </span>
              )
            ) : null}
          </div>
          <p className="mt-1 max-w-prose text-[13px] leading-5 text-fg-2">{description}</p>
          {notConfigured ? <p className="mt-1 max-w-prose text-[13px] leading-5 text-fg-3">Not set up on this deployment yet. Ask whoever runs it.</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {state === "loading" ? (
            <span aria-hidden className="h-8 w-[92px] animate-pulse rounded-md bg-ink-3/70 motion-reduce:animate-none" />
          ) : notConfigured ? null : (
            actions
          )}
        </div>
      </div>
      {notConfigured && envVars?.length ? (
        <TechnicalDetails>
          <ConfigNames names={envVars} />
        </TechnicalDetails>
      ) : null}
      {!notConfigured && children ? <div className="mt-3 space-y-3 text-sm">{children}</div> : null}
    </li>
  );
}

/** An action result in operator language; a config detail behind the disclosure (R3-14). */
export function ActionMessage({ message, isError }: { message: string; isError: boolean }) {
  const m = toOperatorMessage(message);
  return (
    <div>
      <p role={isError ? "alert" : "status"} className={isError ? "text-pink-400" : "text-blue-400"}>
        {m.plain}
      </p>
      {m.technical ? (
        <TechnicalDetails>
          <p className="font-mono text-xs break-words text-fg-1">{m.technical}</p>
        </TechnicalDetails>
      ) : null}
    </div>
  );
}
