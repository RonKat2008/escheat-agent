"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ListChecks } from "lucide-react";
import type { ItemsUi } from "@/lib/chat/ui-types";
import type { StaleItemRow } from "@/lib/queries/schemas";
import { cn } from "@/lib/utils";
import { fmtDate, FooterLink, StatusTag, UnverifiedFlag, useChatActions, ViewCard } from "./parts";

type SortKey = "payee" | "amount" | "age" | "deadline";
const COLLAPSED_ROWS = 8;

const compare: Record<SortKey, (a: StaleItemRow, b: StaleItemRow) => number> = {
  payee: (a, b) => a.payeeName.localeCompare(b.payeeName),
  amount: (a, b) => a.amount.cents - b.amount.cents,
  age: (a, b) => a.ageDays - b.ageDays,
  deadline: (a, b) => (a.nextDeadline?.date ?? "9999").localeCompare(b.nextDeadline?.date ?? "9999"),
};

function itemsHref(filters: ItemsUi["props"]["filters"]): string {
  const q = new URLSearchParams();
  if (typeof filters.state === "string") q.set("state", filters.state);
  if (typeof filters.status === "string") q.set("status", filters.status);
  if (typeof filters.search === "string") q.set("q", filters.search);
  const s = q.toString();
  return s ? `/items?${s}` : "/items";
}

function SortHeader({ k, label, sort, onSort, align = "left" }: { k: SortKey; label: string; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void; align?: "left" | "right" }) {
  const active = sort.key === k;
  const Icon = sort.dir === 1 ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={cn("px-2 py-2 font-normal first:pl-4 last:pr-4", align === "right" && "text-right")}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn("inline-flex items-center gap-1 rounded outline-none hover:text-[var(--chat-t1)] focus-visible:ring-2 focus-visible:ring-[var(--chat-blue-text)]", active && "text-[var(--chat-t1)]")}
      >
        {label}
        <Icon className={cn("size-3", active ? "opacity-100" : "opacity-0")} aria-hidden />
      </button>
    </th>
  );
}

export function ItemsTableView({ asOf, total, items, filters }: ItemsUi["props"]) {
  const { ask, canAsk } = useChatActions();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "amount", dir: -1 });
  const [expanded, setExpanded] = useState(false);
  const sorted = [...items].sort((a, b) => compare[sort.key](a, b) * sort.dir);
  const shown = expanded ? sorted : sorted.slice(0, COLLAPSED_ROWS);
  const onSort = (k: SortKey) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 1 ? -1 : 1 } : { key: k, dir: k === "payee" || k === "deadline" ? 1 : -1 }));
  const label = Object.entries(filters)
    .filter(([k]) => k !== "limit" && k !== "sort")
    .map(([k, v]) => (k === "min_amount_dollars" ? `over $${Number(v).toLocaleString("en-US")}` : k === "state" ? String(v) : `${k.replaceAll("_", " ")}: ${String(v)}`))
    .join(", ");

  return (
    <ViewCard
      testId="view-items"
      icon={<ListChecks />}
      title={label ? `Stale items, ${label}` : "Stale items"}
      meta={`${total} ${total === 1 ? "item" : "items"}, as of ${fmtDate(asOf)}`}
      footer={
        <>
          {sorted.length > COLLAPSED_ROWS ? (
            <button type="button" onClick={() => setExpanded((e) => !e)} className="h-8 rounded-md px-2 text-[13px] text-[var(--chat-t2)] outline-none hover:bg-[var(--chat-ink-3)] hover:text-[var(--chat-t1)] focus-visible:ring-2 focus-visible:ring-[var(--chat-blue-text)]">
              {expanded ? "Show fewer" : `Show all ${sorted.length}`}
            </button>
          ) : null}
          {total > items.length ? <span className="text-xs text-[var(--chat-t3)]">{items.length} of {total} shown</span> : null}
          <span className="flex-1" />
          <FooterLink href={itemsHref(filters)}>Open in Items</FooterLink>
        </>
      }
    >
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--chat-t3)]">No items match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead className="text-left text-xs text-[var(--chat-t3)]">
              <tr className="border-b border-[var(--chat-line)]">
                <SortHeader k="payee" label="Payee" sort={sort} onSort={onSort} />
                <SortHeader k="amount" label="Amount" sort={sort} onSort={onSort} align="right" />
                <SortHeader k="age" label="Age" sort={sort} onSort={onSort} align="right" />
                <th scope="col" className="px-2 py-2 font-normal">State</th>
                <SortHeader k="deadline" label="Next deadline" sort={sort} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr
                  key={i.id}
                  className="group cursor-pointer border-b border-[var(--chat-line)] transition-colors duration-150 last:border-0 hover:bg-[var(--chat-ink-3)]"
                  onClick={() => canAsk && ask(i.checkNumber ? `Explain check #${i.checkNumber}` : `Explain item ${i.id}`)}
                >
                  <td className="max-w-[220px] py-2.5 pr-2 pl-4">
                    <button
                      type="button"
                      disabled={!canAsk}
                      onClick={(e) => {
                        e.stopPropagation();
                        ask(i.checkNumber ? `Explain check #${i.checkNumber}` : `Explain item ${i.id}`);
                      }}
                      className="block max-w-full truncate rounded text-left text-[var(--chat-t1)] outline-none group-hover:text-[var(--chat-blue-text)] focus-visible:ring-2 focus-visible:ring-[var(--chat-blue-text)]"
                    >
                      {i.payeeName}
                    </button>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--chat-t3)]">
                      {i.checkNumber ? `#${i.checkNumber}` : "no ref"}
                      <StatusTag status={i.status} />
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-right text-[var(--chat-t1)] tabular-nums">{i.amount.formatted}</td>
                  <td className="px-2 py-2.5 text-right text-[var(--chat-t2)] tabular-nums">{i.ageDays}d</td>
                  <td className="px-2 py-2.5 text-[var(--chat-t2)]">{i.ownerState ?? "—"}</td>
                  <td className="py-2.5 pr-4 pl-2">
                    {i.nextDeadline ? (
                      <span className="flex items-center gap-1.5 whitespace-nowrap text-[var(--chat-t2)] tabular-nums">
                        {fmtDate(i.nextDeadline.date)}
                        {i.nextDeadline.verified ? null : <UnverifiedFlag compact />}
                      </span>
                    ) : (
                      <span className="text-[var(--chat-t3)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ViewCard>
  );
}
