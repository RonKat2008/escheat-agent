import Link from "next/link";
import { DateCell, Money } from "@/components/primitives";
import { CALL_AFTER_EMAIL_DAYS, EMAIL_AFTER_LETTER_DAYS } from "@/lib/outreach/sequence";
import type { NoticeView } from "./queue-data";

/**
 * One notice per owner: every check the combined letter lists, with the total. The amounts are the stale items'
 * integer cents; the list is part of what the approval is tied to, so a changed item voids it.
 */
export function NoticeItems({ notice }: { notice: NoticeView }) {
  return (
    <section aria-labelledby="notice-items-heading" data-testid="notice-items">
      <h3 id="notice-items-heading" className="mb-1 text-[13px] font-medium text-fg-1">
        One notice, {notice.summary}
      </h3>
      <p className="mb-2.5 max-w-[68ch] text-xs leading-5 text-fg-3">
        This owner gets one letter that lists every open item in this state. Your approval covers the whole list; if an item changes or another one is added, the approval no longer applies.
      </p>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[18rem] text-[13px]">
          <caption className="sr-only">Items listed in this notice</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-fg-3">
              <th scope="col" className="px-3 py-2 font-normal">Check</th>
              <th scope="col" className="px-3 py-2 font-normal">Issued</th>
              <th scope="col" className="px-3 py-2 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {notice.items.map((i) => (
              <tr key={i.staleItemId} className="border-b border-line last:border-b-0" data-testid="notice-item">
                <td className="px-3 py-2">
                  <Link href={`/items?item=${i.staleItemId}`} className="font-mono text-fg-1 underline-offset-2 hover:text-blue-300 hover:underline">
                    {i.referenceNumber ? `#${i.referenceNumber}` : "No number"}
                  </Link>
                </td>
                <td className="px-3 py-2 text-fg-2">
                  <DateCell date={i.issueDate} className="text-[13px] text-fg-2" />
                </td>
                <td className="px-3 py-2 text-right">
                  <Money cents={i.amountCents} className="text-[13px] text-fg-1" />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-strong">
              <th scope="row" colSpan={2} className="px-3 py-2 text-left text-xs font-medium text-fg-2">
                Total
              </th>
              <td className="px-3 py-2 text-right" data-testid="notice-total">
                <Money cents={notice.totalCents} className="text-[13px] font-medium text-fg-1" />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/** The cadence under the channel sequence. A product setting, stated as one, never as a legal rule. */
export function SequenceCadence() {
  return (
    <p className="mt-2 max-w-[68ch] text-xs leading-5 text-fg-3" data-testid="sequence-cadence">
      Letter first, then an email {EMAIL_AFTER_LETTER_DAYS} days later, then a call {CALL_AFTER_EMAIL_DAYS} days after that. This timing is an app setting, not a legal deadline.
    </p>
  );
}
