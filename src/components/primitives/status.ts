import {
  BadgeCheck,
  CheckCircle2,
  Clock,
  Eye,
  FileCheck2,
  FileText,
  MailCheck,
  MessageSquareReply,
  Ban,
  CircleDashed,
  CircleDot,
  Send,
  OctagonX,
  type LucideIcon,
} from "lucide-react";

/**
 * Status without extra hues (docs/DESIGN-RESEARCH.md §3.3). Shape + label carry meaning; colour only reinforces.
 *   attention: needs a human soon. Pink, filled: the loudest thing on screen.
 *   done:      finished. Blue check, label recedes.
 *   active:    in flight. Blue icon, no container.
 *   error:     failed / rejected. Pink outline + octagon.
 *   unknown:   could not be computed. Hollow ring, italic.
 *   neutral:   the common resting state. Plain text, no container, so exceptions pop.
 */
export type Tone = "attention" | "done" | "active" | "error" | "unknown" | "neutral";

export interface StatusMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

/** Single source of truth for every status label/tone/icon in the app. Never inline status colours elsewhere. */
export const STATUS_META: Record<string, StatusMeta> = {
  // stale_items.status
  watching: { label: "Watching", tone: "neutral", icon: Eye },
  dd_pending: { label: "DD due", tone: "attention", icon: Clock },
  dd_sent: { label: "Letter sent", tone: "neutral", icon: MailCheck },
  owner_responded: { label: "Owner replied", tone: "attention", icon: MessageSquareReply },
  resolved_paid: { label: "Paid out", tone: "done", icon: CheckCircle2 },
  to_report: { label: "To report", tone: "attention", icon: Clock },
  reported: { label: "Reported", tone: "neutral", icon: FileCheck2 },
  remitted: { label: "Remitted", tone: "done", icon: BadgeCheck },
  needs_rule: { label: "Needs rule", tone: "unknown", icon: CircleDashed },
  // outreach_status
  draft: { label: "Draft", tone: "neutral", icon: CircleDashed },
  awaiting_approval: { label: "Awaiting approval", tone: "attention", icon: Clock },
  approved: { label: "Approved", tone: "done", icon: CheckCircle2 },
  sent: { label: "Sent", tone: "neutral", icon: Send },
  delivered: { label: "Delivered", tone: "done", icon: MailCheck },
  failed: { label: "Failed", tone: "error", icon: OctagonX },
  responded: { label: "Responded", tone: "attention", icon: MessageSquareReply },
  cancelled: { label: "Cancelled", tone: "neutral", icon: Ban },
  // report_status
  validated: { label: "Validated", tone: "done", icon: CheckCircle2 },
  submitted: { label: "Submitted", tone: "active", icon: Send },
  confirmed: { label: "Confirmed", tone: "done", icon: BadgeCheck },
  // recovery_status
  found: { label: "Found", tone: "done", icon: CheckCircle2 },
  claim_drafted: { label: "Claim drafted", tone: "neutral", icon: FileText },
  claim_submitted: { label: "Claim submitted", tone: "active", icon: Send },
  paid: { label: "Paid", tone: "done", icon: BadgeCheck },
  rejected: { label: "Rejected", tone: "error", icon: OctagonX },
  // agent runs
  running: { label: "Running", tone: "active", icon: CircleDot },
  succeeded: { label: "Succeeded", tone: "done", icon: CheckCircle2 },
};

/** Default list order for stale item statuses (most urgent first). */
export const STALE_STATUS_ORDER = [
  "to_report",
  "dd_pending",
  "owner_responded",
  "dd_sent",
  "needs_rule",
  "watching",
  "reported",
  "resolved_paid",
  "remitted",
] as const;

/** Text colour for a tone's label when it stands alone (no pill). */
export const TONE_TEXT: Record<Tone, string> = {
  attention: "text-pink-400",
  done: "text-fg-2",
  active: "text-fg-2",
  error: "text-pink-400",
  unknown: "text-fg-3 italic",
  neutral: "text-fg-2",
};
/** Icon colour per tone. */
export const TONE_ICON: Record<Tone, string> = {
  attention: "text-pink-500",
  done: "text-blue-500",
  active: "text-blue-400",
  error: "text-pink-400",
  unknown: "text-fg-3",
  neutral: "text-fg-3",
};
/** 6-8px dot per tone (hollow for unknown/error so shape differs, not just colour). */
export const TONE_DOT: Record<Tone, string> = {
  attention: "bg-pink-500",
  done: "bg-blue-500",
  active: "bg-blue-400 es-pulse",
  error: "bg-transparent ring-[1.5px] ring-inset ring-pink-500",
  unknown: "bg-transparent ring-[1.5px] ring-inset ring-fg-3",
  neutral: "bg-fg-3",
};
/** Tinted block for banners and callouts. */
export const TONE_SOFT: Record<Tone, string> = {
  attention: "border-pink-700 bg-pink-900/60 text-pink-300",
  done: "border-blue-800 bg-blue-900/60 text-blue-300",
  active: "border-blue-800 bg-blue-900/60 text-blue-300",
  error: "border-pink-500/60 bg-pink-900/50 text-fg-1",
  unknown: "border-line bg-ink-2 text-fg-2",
  neutral: "border-line bg-ink-2 text-fg-2",
};

export function statusMeta(status: string): StatusMeta {
  return (
    STATUS_META[status] ?? {
      label: status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      tone: "neutral",
      icon: CircleDashed,
    }
  );
}
