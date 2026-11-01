/** Human names for rule-file field paths (as listRuleValues names them). Shared by the Rules page, Items and chat. */

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
