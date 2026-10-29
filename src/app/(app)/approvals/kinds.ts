import { FileText, Mail, MailCheck, PhoneCall, PiggyBank, Scale, type LucideIcon } from "lucide-react";
import type { QueueKind } from "./queue-data";

export const KIND_META: Record<QueueKind, { label: string; plural: string; icon: LucideIcon }> = {
  letter: { label: "Letter", plural: "Letters", icon: MailCheck },
  email: { label: "Email", plural: "Emails", icon: Mail },
  voice: { label: "Call", plural: "Calls", icon: PhoneCall },
  report: { label: "Report", plural: "Reports", icon: FileText },
  claim: { label: "Claim", plural: "Claims", icon: PiggyBank },
  rule: { label: "Rule change", plural: "Rules", icon: Scale },
};

export const FILTERS: { id: "all" | QueueKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "letter", label: "Letters" },
  { id: "email", label: "Email" },
  { id: "voice", label: "Calls" },
  { id: "report", label: "Reports" },
  { id: "claim", label: "Claims" },
];
