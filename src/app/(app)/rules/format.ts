import { formatUSD } from "@/lib/money";

export { fieldMeta, PT_LABEL, type FieldMeta } from "@/lib/rules/labels";

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
    if ("min" in o && "max" in o) return o.max == null ? `${o.min}+ days (no maximum)` : `${o.min}–${o.max} days`;
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
