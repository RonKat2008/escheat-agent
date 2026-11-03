import { CircleAlert } from "lucide-react";
import { DateCell, Money, StatusLabel } from "@/components/primitives";
import { RowCheckbox } from "@/components/b/RowCheckbox";
import { cn } from "@/lib/utils";
import { CHANNEL_LABEL } from "./ChannelSequence";
import type { QueueGroup } from "./group";
import { KIND_META } from "./kinds";
import { OverdueNote } from "./OverdueNote";

export interface RowCheck {
  checked: boolean;
  blocked: string | null;
  onToggle: (checked: boolean) => void;
}

/** "Bayline Electric" from "Mail due-diligence letter · Bayline Electric". */
const shortTitle = (title: string) => title.replace(/^[^·]+· /, "") || title;

/**
 * One queue row: an owner's notice (letter → email → call as one sequence, R3-13) or a single report, claim or rule
 * change. Selected = blue rail + ink-3. A draft that can't be approved says why inline (R2-04), not only in a tooltip.
 */
export function QueueRow({
  group,
  selected,
  onSelect,
  check,
  blockedReason,
}: {
  group: QueueGroup;
  selected: boolean;
  onSelect: () => void;
  check?: RowCheck;
  blockedReason: string | null;
}) {
  const entry = group.lead;
  const Meta = KIND_META[entry.kind];
  const isOutreach = Boolean(entry.outreach);
  const showStatus = !isOutreach && !["draft", "awaiting_approval"].includes(entry.statusKey);
  return (
    <li className="flex items-stretch">
      <span className="flex w-11 shrink-0 items-start justify-center pt-1">
        {check ? (
          <RowCheckbox
            label={`Select ${shortTitle(entry.title)} for bulk approval`}
            checked={check.checked}
            disabled={check.blocked !== null}
            title={check.blocked ?? undefined}
            onToggle={check.onToggle}
            data-testid="approval-select"
          />
        ) : null}
      </span>
      <button
        type="button"
        data-key={entry.key}
        data-group={group.id}
        data-state={group.lead.state ?? undefined}
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "group relative flex w-full items-start gap-3 py-3 pr-4 text-left transition-colors duration-150 outline-none focus-visible:bg-ink-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-400",
          selected ? "bg-ink-3" : "hover:bg-ink-2",
        )}
      >
        <span
          aria-hidden
          className={cn("absolute inset-y-0 left-0 w-0.5 origin-center bg-blue-500 transition-transform duration-150 ease-out", selected ? "scale-y-100" : "scale-y-0")}
        />
        <Meta.icon className={cn("mt-0.5 size-4 shrink-0", selected ? "text-blue-400" : "text-fg-3")} strokeWidth={1.5} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[13px] leading-5 font-medium", group.actionable ? "text-fg-1" : "text-fg-2")}>{shortTitle(entry.title)}</span>
          {isOutreach ? (
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5" data-testid="row-sequence">
              {group.members.map((m, i) => (
                <span key={m.key} className="inline-flex items-center gap-1 text-xs text-fg-3">
                  {i > 0 ? <span aria-hidden className="text-fg-4">→</span> : null}
                  <span className="sr-only">{i === 0 ? "" : "then "}</span>
                  {CHANNEL_LABEL[m.outreach!.channel]}
                  <StatusLabel status={m.statusKey} size="sm" className="text-[11px]" />
                </span>
              ))}
            </span>
          ) : (
            <span className="block truncate text-xs leading-5 text-fg-3">
              {Meta.label}
              {entry.subtitle ? `, ${entry.subtitle}` : ""}
            </span>
          )}
          {isOutreach && entry.subtitle ? <span className="block truncate text-xs leading-5 text-fg-3">{entry.subtitle}</span> : null}
          {showStatus ? <StatusLabel status={entry.statusKey} size="sm" className="mt-1" /> : null}
          {blockedReason ? (
            <span className="mt-1 flex items-start gap-1.5 text-xs leading-5 text-pink-300" data-testid="blocked-reason">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="line-clamp-2">{blockedReason}</span>
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          {entry.amountCents != null ? <Money cents={entry.amountCents} className="text-[13px] text-fg-1" /> : <span className="text-xs text-fg-3">Review</span>}
          {entry.overdue ? (
            <OverdueNote overdue={entry.overdue} compact />
          ) : entry.dueDate ? (
            <span className="text-xs text-fg-3">
              {entry.dueLabel ? `${entry.dueLabel} ` : ""}
              <DateCell date={entry.dueDate} className="text-xs text-fg-3" />
            </span>
          ) : null}
          {group.waiting > 1 ? <span className="text-[11px] text-fg-3">{group.waiting} to approve</span> : null}
        </span>
      </button>
    </li>
  );
}
