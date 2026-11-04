/**
 * plan_close_out: the guided "Close out <STATE>" checklist. The plan is built in code from the company's records
 * (src/lib/close-out), never by the model. Read-only: the card's own buttons run the few safe steps, and every
 * irreversible step links to the human gate.
 */
import { z } from "zod";
import { ClosePlanError } from "@/lib/close-out/plan";
import { formatUSD } from "@/lib/money";
import { buildChatClosePlan } from "../close-plan-runner";
import { ChatToolError, defineTool, STATE } from "./define";

export const planCloseOutTool = defineTool({
  name: "plan_close_out",
  label: "Building the close-out plan",
  description:
    "Builds the ordered close-out checklist for ONE state's current cycle (CA, DE or TX) from the records: due-diligence letters " +
    "(drafted, approved, sent), UNVERIFIED rule values the report relies on, the NAUPA report (generated, validated, awaiting approval, " +
    "submitted), the filing run, and the remittance due. Each step has a status (done, ready, running, needs_approval, blocked with a " +
    "reason), the money at stake and a link to where the person acts. Use for 'close out California', 'what's left for TX?', " +
    "'what's left?'. Read-only: it approves, sends, files and pays nothing.",
  input: z.object({ state: STATE }),
  writes: false,
  async run(ctx, { state }) {
    let plan;
    try {
      plan = await buildChatClosePlan(ctx.db, ctx.companyId, state);
    } catch (err) {
      if (err instanceof ClosePlanError) throw new ChatToolError(err.message);
      throw err;
    }
    const next = plan.steps.find((s) => s.id === plan.nextStepId) ?? null;
    return {
      summary: `${plan.state} close-out: ${plan.done} of ${plan.total} done${plan.notNeeded ? ` · ${plan.notNeeded} not needed` : ""}`,
      data: {
        state: plan.state,
        asOf: plan.asOf,
        done: plan.done,
        total: plan.total,
        notNeeded: plan.notNeeded ?? 0,
        atStake: formatUSD(plan.atStakeCents),
        items: plan.itemCount,
        reportDue: plan.reportDue ? `${plan.reportDue.date ?? "UNKNOWN"}${plan.reportDue.unverified ? " (UNVERIFIED)" : ""}` : null,
        remitDue: plan.remitDue ? `${plan.remitDue.date ?? "UNKNOWN"}${plan.remitDue.unverified ? " (UNVERIFIED)" : ""}` : null,
        // R7-02: the runner's headline deadline (the report's, else the remittance's), with how late it is.
        nextDue: plan.nextDue
          ? `${plan.nextDue.label} ${plan.nextDue.date ?? "UNKNOWN"}${plan.nextDue.unverified ? " (UNVERIFIED)" : ""}${plan.nextDue.daysLate ? `, ${plan.nextDue.daysLate} days late` : ""}`
          : null,
        next: next ? { step: next.title, status: next.status } : null,
        steps: plan.steps.map((s) => ({
          step: s.title,
          status: s.notNeeded ? "not_needed" : s.missed ? "not_sent" : s.status,
          detail: s.detail,
          amount: s.amountCents === null ? null : formatUSD(s.amountCents),
          ...(s.unverified ? { unverified: true } : {}),
          ...(s.late ? { late: `due ${s.late.date}, ${s.late.daysLate} days late` } : {}),
        })),
        approvedOrSentByTool: false,
      },
      ui: { kind: "close_plan", props: { plan } },
    };
  },
});
