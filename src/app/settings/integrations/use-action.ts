"use client";

import { useState } from "react";

export interface ActionState {
  busy: boolean;
  message: string | null;
  isError: boolean;
  /** POST JSON; errors set `message` and resolve undefined, success resolves the parsed body. */
  run: (url: string, body?: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>;
  report: (message: string | null, isError?: boolean) => void;
}

export function useAction(): ActionState {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const report = (m: string | null, err = false) => {
    setMessage(m);
    setIsError(err);
  };
  const run: ActionState["run"] = async (url, body = {}) => {
    setBusy(true);
    report(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        report(typeof json.error === "string" ? json.error : `Request failed (${res.status})`, true);
        return undefined;
      }
      return json;
    } catch (e) {
      report(e instanceof Error ? e.message : "Request failed", true);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, message, isError, run, report };
}
