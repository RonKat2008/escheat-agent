import { formatUSD } from "@/lib/money";

const LABELS: Record<string, string> = {
  naupaCode: "NAUPA property code",
  dormancyYears: "Dormancy period",
  clockStartsFrom: "Dormancy clock starts from",
  minAmountCents: "Minimum reportable amount",
  aggregateThresholdCents: "Aggregate threshold",
  required: "Due diligence required",
  windowDaysBeforeReport: "Notice window before report",
  mailingMethod: "Mailing method",
  requiredLanguage: "Required notice language",
  asOfRule: "Property held as of",
  dueRule: "Report due",
  remitRule: "Remittance due",
  businessDayRollForward: "Roll weekend/holiday deadlines forward",
  interest: "Interest on late reports",
  electronicFormat: "Electronic file format",
  portal: "Filing portal",
};

export const PT_LABEL: Record<string, string> = {
  vendor_check: "Vendor check",
  payroll_check: "Payroll check",
  customer_credit: "Customer credit",
  unapplied_cash: "Unapplied cash",
};

export interface FieldMeta {
  group: string;
  label: string;
  order: number;
}

/** Group + label for a listRuleValues path. */
export function fieldMeta(path: string): FieldMeta {
  const pt = /^propertyTypes\.(\w+)\.(\w+)$/.exec(path);
  if (pt) return { group: PT_LABEL[pt[1]!] ?? pt[1]!, label: LABELS[pt[2]!] ?? pt[2]!, order: 0 };
  const dd = /^dueDiligence\.(\w+)$/.exec(path);
  if (dd) return { group: "Due diligence", label: LABELS[dd[1]!] ?? dd[1]!, order: 10 };
  const st = /^reportStages\[(.+)\]\.(\w+)$/.exec(path);
  if (st) return { group: `Report stage: ${st[1]}`, label: LABELS[st[2]!] ?? st[2]!, order: 20 };
  if (path === "remitRule") return { group: "Remittance", label: LABELS.remitRule!, order: 30 };
  if (path === "businessDayRollForward") return { group: "Remittance", label: LABELS.businessDayRollForward!, order: 30 };
  if (path === "interest") return { group: "Interest", label: LABELS.interest!, order: 40 };
  return { group: "Other", label: LABELS[path] ?? path, order: 90 };
}

const pct = (n: number) => `${n}%`;

/** Human text for a rule value, or null when the value is unknown. */
export function describeValue(path: string, v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const key = path.split(".").pop() ?? path;
  if (typeof v === "number") {
    if (key.endsWith("Cents")) return formatUSD(v);
    if (key === "dormancyYears") return `${v} ${v === 1 ? "year" : "years"}`;
    return String(v);
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return v.replace(/_/g, " ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("min" in o && "max" in o) return `${o.min}–${o.max ?? "no max"} days`;
    if (o.type === "fixed_cutoff") return `Fixed cutoff, ${o.month}/${o.day}`;
    if (o.type === "fiscal_year_end") return "Holder's fiscal year end";
    if (o.type === "fixed_date") return `${o.month}/${o.day}, ${Number(o.yearOffset) >= 0 ? "+" : ""}${o.yearOffset} yr from as-of year`;
    if (o.type === "after_stage") return `${o.months} months after "${o.stage}"`;
    if (o.type === "after_stage_days") return `${o.days} days after "${o.stage}"`;
    if (o.type === "with_report") return `With the "${o.stage}" report`;
    if ("annualRatePct" in o) return `${pct(Number(o.annualRatePct))} per year`;
    return JSON.stringify(o);
  }
  return String(v);
}
