"use client";

import { useState } from "react";
import Link from "next/link";
import { Money, StatusPill } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { formatDate, plural } from "@/lib/format";
import type { PayeeChange } from "@/lib/payees/review-types";
import type { PayeeDetail } from "@/lib/payees/review-queries";
import { BasisCell } from "./basis-cell";

export interface PickerRow {
  id: string;
  canonicalName: string;
  needsReview: boolean;
  itemCount: number;
  outstandingCents: number;
  suggestions: Array<{ otherId: string; score: number; kind: string; decision: boolean }>;
}

const FIELD =
  "h-8 rounded-md border border-line bg-ink-1 px-2.5 text-[13px] text-fg-1 outline-none hover:border-line-hover focus-visible:border-blue-400";

export function PayeeDrawerBody({
  detail,
  all,
  onChange,
}: {
  detail: PayeeDetail;
  all: readonly PickerRow[];
  onChange: (c: PayeeChange) => void;
}) {
  const { payee, items, rawNames } = detail;
  // Key the form state on the payee so switching payees resets it without an effect.
  return <DrawerForm key={payee.id + payee.canonicalName} detail={detail} all={all} onChange={onChange} items={items} rawNames={rawNames} />;
}

function DrawerForm({
  detail,
  all,
  onChange,
  items,
  rawNames,
}: {
  detail: PayeeDetail;
  all: readonly PickerRow[];
  onChange: (c: PayeeChange) => void;
  items: PayeeDetail["items"];
  rawNames: PayeeDetail["rawNames"];
}) {
  const { payee } = detail;
  const [name, setName] = useState(payee.canonicalName);
  const suggested = new Map(payee.suggestions.map((s) => [s.otherId, s]));
  const others = all
    .filter((r) => r.id !== payee.id)
    .sort((a, b) => Number(suggested.has(b.id)) - Number(suggested.has(a.id)) || a.canonicalName.localeCompare(b.canonicalName));
  const [pick, setPick] = useState(payee.suggestions[0]?.otherId ?? "");
  const lines = new Map(rawNames.map((r) => [r.name, r.lines]));

  return (
    <div className="space-y-6 p-5" data-testid="payee-drawer-body">
      <header className="space-y-1 pr-8">
        <h2 className="text-base font-semibold text-fg-1">{payee.canonicalName}</h2>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-2">
          <span>
            <span className="num text-fg-1">{payee.openItemCount}</span> open of <span className="num">{plural(payee.itemCount, "item")}</span>
          </span>
          <Money cents={payee.outstandingCents} className="text-fg-1" />
          <span>{payee.ownerStates.length ? `Owner state ${payee.ownerStates.join(", ")}` : "No open owner state"}</span>
        </p>
        <p className="text-[13px] text-fg-2">
          Merge basis: <BasisCell row={payee} />
        </p>
        {payee.reviewedBy ? (
          <p className="text-xs text-fg-3" data-testid="payee-review-trail">
            Last {payee.reviewAction} by {payee.reviewedBy}
            {payee.reviewedAt ? ` on ${formatDate(payee.reviewedAt.slice(0, 10))}` : ""}.
          </p>
        ) : null}
        {payee.reasons.length ? (
          <ul className="space-y-1 pt-1">
            {payee.reasons.map((r) => (
              <li key={r} className="text-[13px] text-pink-300">
                {r}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <section aria-labelledby="alias-h" className="space-y-2 border-t border-line pt-4">
        <h3 id="alias-h" className="text-sm font-medium text-fg-1">
          Aliases
        </h3>
        {payee.aliases.length === 0 ? (
          <p className="text-[13px] text-fg-3">No aliases. Every ledger line uses the canonical name.</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {payee.aliases.map((a) => {
              const n = lines.get(a) ?? 0;
              return (
                <li key={a} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                  <span className="min-w-0 truncate text-fg-1">
                    {a} <span className="text-fg-3">({plural(n, "line")})</span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={n === 0}
                    aria-label={`Split ${a} into its own payee`}
                    onClick={() => onChange({ kind: "split", payeeId: payee.id, alias: a })}
                  >
                    Split out
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="rename-h" className="space-y-2 border-t border-line pt-4">
        <h3 id="rename-h" className="text-sm font-medium text-fg-1">
          Canonical name
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <label className="min-w-0 flex-1 basis-48">
            <span className="sr-only">New canonical name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className={`${FIELD} w-full`} />
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={name.trim().length < 2 || name.trim() === payee.canonicalName}
            onClick={() => onChange({ kind: "rename", payeeId: payee.id, canonicalName: name.trim() })}
          >
            Review rename
          </Button>
        </div>
      </section>

      <section aria-labelledby="merge-h" className="space-y-2 border-t border-line pt-4">
        <h3 id="merge-h" className="text-sm font-medium text-fg-1">
          Merge another payee into this one
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <label className="min-w-0 flex-1 basis-48">
            <span className="sr-only">Payee to merge into {payee.canonicalName}</span>
            <select value={pick} onChange={(e) => setPick(e.target.value)} className={`${FIELD} w-full`}>
              <option value="">Choose a payee</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {suggested.has(o.id) ? "Suggested: " : ""}
                  {o.canonicalName}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="outline" disabled={!pick} onClick={() => onChange({ kind: "merge", keepId: payee.id, mergeId: pick })}>
            Review merge
          </Button>
        </div>
      </section>

      <section aria-labelledby="items-h" className="space-y-2 border-t border-line pt-4">
        <h3 id="items-h" className="text-sm font-medium text-fg-1">
          Items
        </h3>
        {items.length === 0 ? (
          <p className="text-[13px] text-fg-3">No stale items belong to this payee.</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line" data-testid="payee-items">
            {items.map((i) => (
              <li key={i.staleItemId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
                <Link href={`/items?item=${i.staleItemId}`} className="font-mono text-xs text-blue-400 underline-offset-4 hover:text-blue-300 hover:underline">
                  {i.checkNumber ? `#${i.checkNumber}` : "No check #"}
                </Link>
                <span className="min-w-0 flex-1 truncate text-fg-2">{i.payeeNameRaw}</span>
                <span className="text-fg-2">{i.ownerState ?? "Unknown"}</span>
                <Money cents={i.amountCents} className="text-fg-1" />
                <StatusPill status={i.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
