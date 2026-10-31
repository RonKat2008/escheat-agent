import { AlertTriangle, KeyRound, Lock, ShieldAlert, WifiOff, Ban } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ApiFailure } from "./api";

interface Shape {
  title: string;
  message: ReactNode;
  icon: typeof Lock;
  tone: "amber" | "red" | "slate";
}

function shapeOf(f: ApiFailure): Shape {
  if (f.status === 501 || f.code === "not_configured") {
    const vars = f.missing?.length ? f.missing : [];
    const service = (f.service ?? "service").replace(/^./, (c) => c.toUpperCase());
    return {
      title: `${service === "Lob" ? "Lob test key" : service} not configured`,
      icon: KeyRound,
      tone: "slate",
      message: (
        <>
          Nothing was sent. {vars.length ? "Add " : "Add the missing key to .env.local and restart."}
          {vars.map((v, i) => (
            <span key={v}>
              {i > 0 ? ", " : ""}
              <code className="rounded bg-sunken px-1 py-0.5 font-mono text-xs text-foreground">{v}</code>
            </span>
          ))}
          {vars.length ? " to .env.local and restart the server." : null}
        </>
      ),
    };
  }
  if (f.code === "recipient_not_allowed")
    return { title: "Recipient is not on the test allowlist", icon: ShieldAlert, tone: "red", message: "Emails and calls only go to addresses in ALLOWED_TEST_RECIPIENTS and ALLOWED_TEST_PHONES. Nothing was sent." };
  if (f.code === "live_key_refused")
    return { title: "Live Lob key refused", icon: ShieldAlert, tone: "red", message: "Only Lob test keys (starting with test_) can be used in this prototype." };
  if (f.code === "approval_required" || f.status === 403)
    return { title: "Approval required", icon: Lock, tone: "amber", message: f.error };
  if (f.status === 409)
    return { title: f.code === "approval_consumed" || f.code === "already_sent" ? "Already used" : "Conflict", icon: Ban, tone: "slate", message: f.error };
  if (f.code === "not_ready" || f.status === 422)
    return { title: "Not ready to send", icon: AlertTriangle, tone: "amber", message: f.problems?.length ? f.problems.join(" ") : f.error };
  if (f.code === "network") return { title: "Can't reach the server", icon: WifiOff, tone: "red", message: f.error };
  return { title: f.status >= 500 ? "The server hit a problem" : "Request failed", icon: AlertTriangle, tone: "red", message: f.error };
}

const TONE = {
  amber: "border-pink-500/60 bg-pink-900/40",
  red: "border-pink-500/60 bg-pink-900/40",
  slate: "border-strong bg-raised",
} as const;
const ICON = { amber: "text-pink-400", red: "text-pink-400", slate: "text-muted-foreground" } as const;

/** Designed inline state for API errors: 403 / 409 / 422 / 501 each read as a decision, not a stack trace. */
export function ApiProblem({ failure, className }: { failure: ApiFailure; className?: string }) {
  const s = shapeOf(failure);
  const Icon = s.icon;
  return (
    <div role="alert" data-testid="api-problem" data-status={failure.status} className={cn("flex items-start gap-3 rounded-xl border p-3.5", TONE[s.tone], className)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", ICON[s.tone])} aria-hidden />
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{s.title}</p>
        <p className="text-sm break-words text-muted-foreground">{s.message}</p>
      </div>
    </div>
  );
}
