"use client";

import { useState, type MouseEvent } from "react";
import { Dialog as DrawerPrimitive } from "@base-ui/react/dialog";
import { parseAsString, useQueryState } from "nuqs";
import { CheckCircle2, ChevronDown, ChevronRight, NotebookText, X } from "lucide-react";
import { SourceLink, UnknownBadge, UnverifiedBadge } from "@/components/primitives";
import { cn } from "@/lib/utils";
import { ApproveButton } from "./approve-button";
import { FieldDrawerBody } from "./field-drawer";
import type { RuleGroup, RuleRow } from "./rules-types";

type Props = {
  state: string;
  version: string;
  sha256: string;
  groups: RuleGroup[];
};

function StatusCell({ row }: { row: RuleRow }) {
  if (!row.verified) return <span className="flex h-5 items-center"><UnverifiedBadge compact /></span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-fg-2">
      <CheckCircle2 className="size-3.5 shrink-0 text-blue-500" strokeWidth={1.75} aria-hidden />
      <span className="sr-only md:not-sr-only">Verified</span>
      {row.verifiedBy ? <span className="hidden min-w-0 truncate text-fg-3 lg:inline">{row.verifiedBy}</span> : <span className="sr-only">{row.verifiedBy}</span>}
    </span>
  );
}

function ValueText({ row, className }: { row: RuleRow; className?: string }) {
  if (row.value === null) return <UnknownBadge label="Unknown" className={className} />;
  return (
    <span className={cn("min-w-0 truncate font-medium text-fg-1", row.code && "font-mono text-[12.5px]", className)} title={row.value}>
      {row.value}
    </span>
  );
}

function SourcesCell({ row }: { row: RuleRow }) {
  const [first, ...rest] = row.sources;
  if (!first) return <span className="text-xs text-fg-3">None cited</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <SourceLink url={first.url} title={first.title} quote={first.quote} className="min-w-0" />
      {rest.length > 0 ? (
        <span className="num shrink-0 text-xs text-fg-3" aria-label={`${rest.length} more source${rest.length > 1 ? "s" : ""}`}>
          +{rest.length}
        </span>
      ) : null}
    </span>
  );
}

function FieldRowView({ row, selected, onOpen, state, version, sha256 }: { row: RuleRow; selected: boolean; onOpen: () => void } & Omit<Props, "groups">) {
  const handleRowClick = (e: MouseEvent<HTMLTableRowElement>) => {
    // Clicks inside portalled dialogs bubble through React; ignore those and any nested control.
    if (!e.currentTarget.contains(e.target as Node)) return;
    if ((e.target as HTMLElement).closest("a,button,input")) return;
    onOpen();
  };
  return (
    <tr data-field={row.path} data-selected={selected || undefined} onClick={handleRowClick} className="group/row cursor-pointer border-b border-line hover:bg-ink-2">
      <td className="py-2 pr-3 pl-0 align-middle md:h-10 md:py-0">
        <button
          type="button"
          onClick={onOpen}
          className="flex w-full min-w-0 flex-col items-start rounded-sm pl-3 text-left"
        >
          <span className="max-w-full truncate text-xs text-fg-3 md:text-[13px] md:text-fg-2">{row.label}</span>
          <span className="mt-0.5 flex max-w-full min-w-0 items-center gap-1.5 text-[13px] md:hidden">
            <ValueText row={row} />
            {row.todo ? <NotebookText className="size-3.5 shrink-0 text-fg-3" strokeWidth={1.5} aria-hidden /> : null}
          </span>
          {/* Extends (never replaces) the visible text, so the accessible name still contains it (WCAG 2.5.3). */}
          <span className="sr-only">, {row.group}. Open details</span>
        </button>
      </td>
      <td className="hidden px-3 align-middle md:table-cell">
        <span className="flex min-w-0 items-center gap-2">
          <ValueText row={row} />
          {row.todo ? (
            <span className="shrink-0 text-fg-3" title="Has a research note">
              <NotebookText className="size-3.5" strokeWidth={1.5} aria-hidden />
              <span className="sr-only">Has a research note</span>
            </span>
          ) : null}
        </span>
      </td>
      <td className="hidden px-3 align-middle lg:table-cell">
        <SourcesCell row={row} />
      </td>
      <td className="px-3 align-middle">
        <StatusCell row={row} />
      </td>
      <td className="hidden pr-3 pl-1 align-middle md:table-cell">
        <span className="flex items-center justify-end gap-1">
          {row.approvable ? (
            <ApproveButton
              state={state}
              path={row.path}
              expectedVersion={version}
              expectedSha256={sha256}
              label="Approve"
              subject={`${row.label.toLowerCase()} (${row.group})`}
              variant="ghost"
              size="sm"
              className="opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 group-data-[selected=true]/row:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
            />
          ) : null}
          <ChevronRight className="size-4 text-fg-4 transition-colors duration-150 group-hover/row:text-fg-2" strokeWidth={1.5} aria-hidden />
        </span>
      </td>
    </tr>
  );
}

function GroupSection({
  group,
  open,
  onToggle,
  selectedPath,
  onOpenRow,
  ...ctx
}: {
  group: RuleGroup;
  open: boolean;
  onToggle: () => void;
  selectedPath: string | null;
  onOpenRow: (path: string) => void;
} & Omit<Props, "groups">) {
  const verified = group.rows.filter((r) => r.verified).length;
  const id = `grp-${group.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  return (
    <section aria-labelledby={`${id}-h`} className="border-t border-line">
      <h3 id={`${id}-h`}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={id}
          className="group/g flex w-full items-center gap-2 rounded-sm py-3 text-left"
        >
          <ChevronDown
            className={cn("size-4 shrink-0 text-fg-3 transition-transform duration-200 ease-[var(--ease-out)] motion-reduce:transition-none", !open && "-rotate-90")}
            strokeWidth={1.5}
            aria-hidden
          />
          <span className="text-sm font-medium text-fg-1">{group.name}</span>
          <span className="num ml-auto text-xs text-fg-3 transition-colors duration-150 group-hover/g:text-fg-2">
            {verified} / {group.rows.length} verified
          </span>
        </button>
      </h3>
      <div
        id={id}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-in-out)] motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <table className="mb-4 w-full table-fixed text-[13px]" aria-label={`${group.name} rule values`}>
            <colgroup>
              <col className="md:w-[26%]" />
              <col className="hidden md:table-column" />
              <col className="hidden w-[200px] lg:table-column xl:w-[240px]" />
              <col className="w-[52px] md:w-[110px] lg:w-[170px]" />
              <col className="hidden w-[132px] md:table-column" />
            </colgroup>
            <thead className="sr-only">
              <tr>
                <th scope="col">Field</th>
                <th scope="col" className="hidden md:table-cell">Value</th>
                <th scope="col" className="hidden lg:table-cell">Sources</th>
                <th scope="col">Status</th>
                <th scope="col" className="hidden md:table-cell">Action</th>
              </tr>
            </thead>
            <tbody className="border-t border-line">
              {group.rows.map((r) => (
                <FieldRowView key={r.path} row={r} selected={r.path === selectedPath} onOpen={() => onOpenRow(r.path)} {...ctx} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/** Rule values grouped into collapsible sections; one line per value; detail opens in a side drawer (?field=). */
export function RulesTable({ state, version, sha256, groups }: Props) {
  const [field, setField] = useQueryState("field", parseAsString);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const rows = groups.flatMap((g) => g.rows);
  const active = field ? (rows.find((r) => r.path === field) ?? null) : null;
  const allCollapsed = collapsed.size === groups.length;
  // Keep the last opened row so the drawer content stays put while it slides out.
  const [shown, setShown] = useState<RuleRow | null>(active);
  if (active && active !== shown) setShown(active);

  const toggle = (name: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const close = () => void setField(null);

  return (
    <div>
      <div className="mb-1 flex items-center justify-end text-xs text-fg-3">
        <button
          type="button"
          onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.name)))}
          className="rounded-sm py-1 transition-colors duration-150 hover:text-fg-1"
        >
          {allCollapsed ? "Expand all" : "Collapse all"}
        </button>
      </div>
      {groups.map((g) => (
        <GroupSection
          key={g.name}
          group={g}
          open={!collapsed.has(g.name)}
          onToggle={() => toggle(g.name)}
          selectedPath={active?.path ?? null}
          onOpenRow={(p) => void setField(p)}
          state={state}
          version={version}
          sha256={sha256}
        />
      ))}

      <DrawerPrimitive.Root open={active !== null} onOpenChange={(o) => (!o ? close() : undefined)} modal={false} disablePointerDismissal>
        <DrawerPrimitive.Portal>
          {/* Below lg the drawer covers the table, so dim it and let a tap outside close it. Wide screens stay scrim-free. */}
          <div aria-hidden data-testid="field-drawer-scrim" onClick={close} className="fixed inset-0 z-30 bg-black/50 lg:hidden" />
          <DrawerPrimitive.Popup
            initialFocus={() => window.matchMedia("(max-width: 1023px)").matches}
            data-testid="field-drawer"
            aria-label="Rule value details"
            className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line-hover bg-ink-1 text-sm shadow-[var(--shadow-overlay)] outline-none transition-[transform,opacity] duration-[320ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:translate-x-full data-ending-style:duration-200 data-ending-style:ease-[cubic-bezier(0.65,0,0.35,1)] data-starting-style:translate-x-full motion-reduce:transition-none sm:w-[480px]"
          >
            <DrawerPrimitive.Title className="sr-only">Rule value details</DrawerPrimitive.Title>
            <DrawerPrimitive.Close
              aria-label="Close rule value details"
              className="absolute top-3.5 right-3.5 z-10 grid size-8 place-items-center rounded-md text-fg-3 transition-colors duration-150 hover:bg-ink-3 hover:text-fg-1"
            >
              <X className="size-4" strokeWidth={1.5} aria-hidden />
            </DrawerPrimitive.Close>
            <div className="relative min-h-0 flex-1 overflow-y-auto">
              {shown ? <FieldDrawerBody row={shown} state={state} version={version} sha256={sha256} /> : null}
            </div>
          </DrawerPrimitive.Popup>
        </DrawerPrimitive.Portal>
      </DrawerPrimitive.Root>
    </div>
  );
}
