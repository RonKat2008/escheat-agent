import { CheckCircle2, CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { ValidationError } from "@/lib/reports/validate";
import { cn } from "@/lib/utils";

interface IssueRow {
  field: string;
  message: string;
  records: number[];
}

function groupWarnings(warns: ValidationError[]): IssueRow[] {
  const map = new Map<string, IssueRow>();
  for (const w of warns) {
    const k = `${w.field}|${w.message}`;
    const prev = map.get(k);
    map.set(k, prev ? { ...prev, records: [...prev.records, w.record] } : { field: w.field, message: w.message, records: [w.record] });
  }
  return [...map.values()];
}

function recordsLabel(r: number[]): string {
  if (r.length === 1) return r[0] === 0 ? "file" : `record ${r[0]}`;
  return `${r.length} records`;
}

function ErrorList({ rows }: { rows: IssueRow[] }) {
  return (
    <ul className="divide-y divide-pink-500/25 rounded-xl border border-pink-500/60 bg-pink-900/40" aria-label="Validation errors">
      {rows.map((e, i) => (
        <li key={`${e.field}${e.message}${e.records[0]}`} className="es-rise flex items-start gap-3 px-4 py-3" style={{ ["--i" as string]: i }}>
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-pink-400" strokeWidth={1.75} aria-hidden />
          <div className="min-w-0">
            <p className="text-sm text-fg-1">{e.message}</p>
            <p className="mt-1 font-mono text-xs break-all text-fg-3">
              {recordsLabel(e.records)} · {e.field}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function WarningList({ rows }: { rows: IssueRow[] }) {
  return (
    <ul className="divide-y divide-line border-y border-line" aria-label="Validation warnings">
      {rows.map((w, i) => (
        <li key={`${w.field}${w.message}`} className="es-rise flex items-start gap-3 py-2.5" style={{ ["--i" as string]: i }}>
          <Info className="mt-0.5 size-4 shrink-0 text-fg-3" strokeWidth={1.75} aria-hidden />
          <div className="min-w-0">
            <p className="text-sm text-fg-2">{w.message}</p>
            <p className="mt-0.5 font-mono text-xs break-all text-fg-3">
              {recordsLabel(w.records)} · {w.field}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Validation({ errors }: { errors: ValidationError[] }) {
  const errs = errors.filter((e) => e.severity === "error");
  const warns = errors.filter((e) => e.severity === "warning");
  const grouped = groupWarnings(warns);
  return (
    <section aria-labelledby="validation-h" className="min-w-0 border-t border-line pt-5">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id="validation-h" className="text-sm font-medium text-fg-1">
          Validation
        </h3>
        <span className={cn("inline-flex flex-wrap items-center gap-x-1.5 text-[13px]", errs.length ? "text-pink-400" : "text-blue-400")} data-testid="validation-summary">
          {errs.length ? <CircleAlert className="size-3.5" aria-hidden /> : <CheckCircle2 className="size-3.5" aria-hidden />}
          {errs.length ? `${errs.length} error${errs.length > 1 ? "s" : ""}` : "Passed with no errors"}
          {warns.length ? (
            <span className="whitespace-nowrap text-fg-3">
              · {warns.length} warning{warns.length > 1 ? "s" : ""}
            </span>
          ) : null}
        </span>
      </div>
      {errors.length === 0 ? <p className="text-sm text-fg-2">Record layout, totals, property codes and dates all match the state rule file.</p> : null}
      {errs.length > 0 ? <ErrorList rows={errs.map((e) => ({ field: e.field, message: e.message, records: [e.record] }))} /> : null}
      {warns.length > 0 ? (
        <details className={cn("group", errs.length > 0 && "mt-5")}>
          <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 text-sm text-fg-2 outline-none hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 [&::-webkit-details-marker]:hidden">
            <span>
              {grouped.length} optional field{grouped.length > 1 ? "s are" : " is"} blank across {warns.length} entries. These do not block filing.
            </span>
            <span className="shrink-0 text-xs text-fg-3 underline underline-offset-2 group-open:hidden">Show</span>
            <span className="hidden shrink-0 text-xs text-fg-3 underline underline-offset-2 group-open:inline">Hide</span>
          </summary>
          <div className="mt-2">
            <WarningList rows={grouped} />
          </div>
        </details>
      ) : null}
    </section>
  );
}

/** Ghosted preview of what validation will look like, shown before a report exists. Decorative. */
export function ValidationGhost() {
  const rows = [
    { dashed: false, w: "w-3/5" },
    { dashed: false, w: "w-1/2" },
    { dashed: true, w: "w-4/5" },
    { dashed: false, w: "w-2/5" },
  ];
  return (
    <div aria-hidden className="select-none" data-testid="validation-ghost">
      <ul className="divide-y divide-line border-y border-line opacity-60">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-3 py-3.5">
            <span className={cn("size-4 shrink-0 rounded-full border border-fg-4", r.dashed && "border-dashed")} />
            <span className={cn("h-2 rounded-full bg-ink-3", r.w)} />
            <span className="ml-auto hidden h-2 w-16 rounded-full bg-ink-3 sm:block" />
          </li>
        ))}
      </ul>
    </div>
  );
}
