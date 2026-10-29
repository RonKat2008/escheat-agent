import {
  BadgeCheck,
  CheckCircle2,
  Eye,
  FileCheck2,
  FileWarning,
  HelpCircle,
  Hourglass,
  MailCheck,
  MessageSquareReply,
  Ban,
  CircleDashed,
  Send,
  XCircle,
  type LucideIcon,
} from "lucide-react";

export type Tone = "amber" | "green" | "slate" | "sky" | "red";
export type PillStyle = "soft" | "outline" | "solid";

export interface StatusMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
  style: PillStyle;
}

/** Single source of truth for every status label/color/icon in the app. Never inline status colors elsewhere. */
export const STATUS_META: Record<string, StatusMeta> = {
  // stale_items.status
  watching: { label: "Watching", tone: "slate", icon: Eye, style: "soft" },
  dd_pending: { label: "DD Due", tone: "amber", icon: Hourglass, style: "soft" },
  dd_sent: { label: "Letter Sent", tone: "amber", icon: MailCheck, style: "outline" },
  owner_responded: { label: "Owner Replied", tone: "sky", icon: MessageSquareReply, style: "soft" },
  resolved_paid: { label: "Paid Out", tone: "green", icon: CheckCircle2, style: "soft" },
  to_report: { label: "To Report", tone: "amber", icon: FileWarning, style: "solid" },
  reported: { label: "Reported", tone: "slate", icon: FileCheck2, style: "soft" },
  remitted: { label: "Remitted", tone: "green", icon: BadgeCheck, style: "solid" },
  needs_rule: { label: "Needs Rule", tone: "red", icon: HelpCircle, style: "outline" },
  // outreach_status
  draft: { label: "Draft", tone: "slate", icon: CircleDashed, style: "soft" },
  awaiting_approval: { label: "Awaiting Approval", tone: "amber", icon: Hourglass, style: "outline" },
  approved: { label: "Approved", tone: "sky", icon: CheckCircle2, style: "soft" },
  sent: { label: "Sent", tone: "slate", icon: Send, style: "soft" },
  delivered: { label: "Delivered", tone: "green", icon: MailCheck, style: "soft" },
  failed: { label: "Failed", tone: "red", icon: XCircle, style: "soft" },
  responded: { label: "Responded", tone: "sky", icon: MessageSquareReply, style: "soft" },
  cancelled: { label: "Cancelled", tone: "slate", icon: Ban, style: "outline" },
  // report_status
  validated: { label: "Validated", tone: "sky", icon: CheckCircle2, style: "soft" },
  submitted: { label: "Submitted", tone: "slate", icon: Send, style: "soft" },
  confirmed: { label: "Confirmed", tone: "green", icon: BadgeCheck, style: "solid" },
  // recovery_status
  found: { label: "Found", tone: "green", icon: CheckCircle2, style: "soft" },
  claim_drafted: { label: "Claim Drafted", tone: "slate", icon: FileCheck2, style: "soft" },
  claim_submitted: { label: "Claim Submitted", tone: "sky", icon: Send, style: "soft" },
  paid: { label: "Paid", tone: "green", icon: BadgeCheck, style: "solid" },
  rejected: { label: "Rejected", tone: "red", icon: XCircle, style: "soft" },
  // agent runs
  running: { label: "Running", tone: "sky", icon: CircleDashed, style: "outline" },
  succeeded: { label: "Succeeded", tone: "green", icon: CheckCircle2, style: "soft" },
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

export const TONE_TEXT: Record<Tone, string> = {
  amber: "text-at-risk",
  green: "text-resolved",
  slate: "text-slate",
  sky: "text-sky",
  red: "text-danger",
};
export const TONE_DOT: Record<Tone, string> = {
  amber: "bg-at-risk",
  green: "bg-resolved",
  slate: "bg-slate",
  sky: "bg-sky",
  red: "bg-danger",
};
export const TONE_SOFT: Record<Tone, string> = {
  amber: "bg-at-risk/14 border-at-risk/45 text-at-risk",
  green: "bg-resolved/14 border-resolved/40 text-resolved",
  slate: "bg-slate/14 border-slate/30 text-slate",
  sky: "bg-sky/13 border-sky/35 text-sky",
  red: "bg-danger/14 border-danger/40 text-danger",
};
export const TONE_OUTLINE: Record<Tone, string> = {
  amber: "border-at-risk/55 text-at-risk",
  green: "border-resolved/50 text-resolved",
  slate: "border-slate/40 text-slate",
  sky: "border-sky/45 text-sky",
  red: "border-danger/50 text-danger",
};
export const TONE_SOLID: Record<Tone, string> = {
  amber: "bg-at-risk border-at-risk text-[#0b1220]",
  green: "bg-resolved border-resolved text-[#0b1220]",
  slate: "bg-slate border-slate text-[#0b1220]",
  sky: "bg-sky border-sky text-[#0b1220]",
  red: "bg-danger border-danger text-[#0b1220]",
};

export function statusMeta(status: string): StatusMeta {
  return (
    STATUS_META[status] ?? {
      label: status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
      tone: "slate",
      icon: CircleDashed,
      style: "soft",
    }
  );
}
