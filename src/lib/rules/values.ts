import type { RuleFile, RuleValue, RulePropertyType } from "../../../rules/schema";
import { PROPERTY_TYPES } from "../../../rules/schema";

export interface PathedRuleValue {
  path: string;
  rv: RuleValue<unknown>;
}

/** Every RuleValue in the file with a stable path. References are live (not copies). */
export function listRuleValues(file: RuleFile): PathedRuleValue[] {
  const out: PathedRuleValue[] = [];
  for (const pt of PROPERTY_TYPES) {
    const rule = file.propertyTypes[pt];
    if (!rule) continue;
    for (const [k, rv] of Object.entries(rule)) out.push({ path: `propertyTypes.${pt}.${k}`, rv: rv as RuleValue<unknown> });
  }
  for (const [k, rv] of Object.entries(file.dueDiligence)) {
    out.push({ path: `dueDiligence.${k}`, rv: rv as RuleValue<unknown> });
  }
  for (const st of file.reportStages) {
    out.push({ path: `reportStages[${st.name}].asOfRule`, rv: st.asOfRule as RuleValue<unknown> });
    out.push({ path: `reportStages[${st.name}].dueRule`, rv: st.dueRule as RuleValue<unknown> });
  }
  out.push({ path: "remitRule", rv: file.remitRule as RuleValue<unknown> });
  out.push({ path: "businessDayRollForward", rv: file.businessDayRollForward as RuleValue<unknown> });
  out.push({ path: "interest", rv: file.interest as RuleValue<unknown> });
  return out;
}

/** RuleValues relevant to one property type (its own five + all shared ones). */
export function listRuleValuesFor(file: RuleFile, pt: RulePropertyType): PathedRuleValue[] {
  return listRuleValues(file).filter((v) => !v.path.startsWith("propertyTypes.") || v.path.startsWith(`propertyTypes.${pt}.`));
}

export const allVerified = (values: PathedRuleValue[]) => values.length > 0 && values.every((v) => v.rv.verified);
