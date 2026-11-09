"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, CircleDashed, FileText, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ImportCardUi } from "@/lib/chat/ui-types";
import type { ColumnMapping } from "@/lib/ingest/mapping";
import {
  describeErrorGroup,
  duplicateHeaders,
  fieldsFor,
  formatFileSize,
  interpretIngestResponse,
  interpretPreviewResponse,
  MAX_GROUPS_SHOWN,
  missingRequired,
  pipelineHeadline,
  previewColumns,
  setColumn,
  validateCsvFile,
  type IngestPreviewView,
  type IngestResultView,
} from "@/lib/integrations/csv-upload";
import { cn } from "@/lib/utils";
import { ActionCardFrame } from "./frame";

type Kind = ImportCardUi["props"]["fileKind"];
type Problem = { message: string; details: string[] };

const KIND_LABEL: Record<Kind, string> = { ledger: "Check register", clears: "Bank clears" };
/** Row errors listed one by one in the preview; the groups above them always cover the rest. */
const ROW_ERRORS_SHOWN = 8;

async function postIngest(body: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
  const res = await fetch("/api/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

function StepTitle({ n, children, active }: { n: number; children: string; active: boolean }) {
  return (
    <p className={cn("flex items-center gap-2 text-[13px] font-medium", active ? "text-fg-1" : "text-fg-3")}>
      <span className={cn("num grid size-5 place-items-center rounded-full text-[11px]", active ? "bg-fg-1/10 text-fg-1" : "bg-fg-1/5 text-fg-3")} aria-hidden>
        {n}
      </span>
      {children}
    </p>
  );
}

function ProblemBox({ problem }: { problem: Problem }) {
  return (
    <div role="alert" data-testid="import-error" className="flex gap-2 rounded-[12px] border border-pink-500/40 bg-pink-900/40 px-3 py-2.5 text-[13px] text-fg-1">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-pink-400" strokeWidth={1.5} aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="text-pretty">{problem.message}</p>
        {problem.details.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-4 text-xs break-words text-fg-2">
            {problem.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function PreviewPanel({ preview, kind, mapping }: { preview: IngestPreviewView; kind: Kind; mapping: ColumnMapping }) {
  const cols = previewColumns(kind, mapping);
  return (
    <div className="space-y-3" data-testid="import-preview">
      <p className="text-[13px] text-fg-2">
        <span className="num font-medium text-fg-1" data-testid="import-preview-valid">
          {preview.validRows}
        </span>{" "}
        {preview.validRows === 1 ? "row is" : "rows are"} ready to import;{" "}
        <span className={cn("num font-medium", preview.errorCount > 0 ? "text-pink-400" : "text-fg-1")} data-testid="import-preview-errors">
          {preview.errorCount}
        </span>{" "}
        {preview.errorCount === 1 ? "row would be rejected" : "rows would be rejected"}. Nothing is stored yet.
      </p>
      {preview.sample.length > 0 ? (
        <div className="max-w-full overflow-x-auto rounded-[12px] border border-line">
          <table className="w-full min-w-max text-left text-xs">
            <caption className="sr-only">First rows as they would be imported</caption>
            <thead className="text-fg-3">
              <tr>
                {cols.map((c) => (
                  <th key={c.field} scope="col" className="px-3 py-2 font-normal whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="num divide-y divide-line text-fg-1">
              {preview.sample.map((row, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c.field} className="max-w-[220px] truncate px-3 py-1.5 whitespace-nowrap">
                      {row[c.field] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {preview.rowErrors.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-fg-2">Rows that would not be imported (spreadsheet line numbers; the header is line 1):</p>
          <ul className="num space-y-1 text-xs break-words text-fg-2" data-testid="import-row-errors">
            {preview.rowErrors.slice(0, ROW_ERRORS_SHOWN).map((e, i) => (
              <li key={`${e.line}-${i}`} className="flex gap-2">
                <span className="shrink-0 text-pink-400">Line {e.line}</span>
                <span className="min-w-0">
                  {e.field ? <span className="text-fg-3">{e.field}: </span> : null}
                  {e.message}
                </span>
              </li>
            ))}
            {preview.errorCount > ROW_ERRORS_SHOWN ? <li className="text-fg-3">+{preview.errorCount - ROW_ERRORS_SHOWN} more</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ResultPanel({ result, fileName }: { result: IngestResultView; fileName: string }) {
  const ok = result.inserted > 0;
  const Icon = ok ? CircleCheck : CircleDashed;
  return (
    <div role="status" className="space-y-2" data-testid="import-result">
      <p className="flex items-start gap-2 text-sm text-fg-1" data-testid="import-result-headline">
        <Icon className={cn("mt-0.5 size-4 shrink-0", ok ? "text-blue-400" : "text-fg-3")} strokeWidth={1.75} aria-hidden />
        <span>
          {ok ? `Imported ${result.inserted} ${result.inserted === 1 ? "row" : "rows"}` : "Nothing new imported"} from {fileName}
          {!ok && result.skipped > 0 ? "; every row was already stored" : ""}.
        </span>
      </p>
      <p className="num text-xs text-fg-2">
        {result.inserted} inserted · {result.skipped} skipped as duplicates · {result.errorCount} rejected
        {result.payeesLinked !== undefined ? ` · ${result.payeesLinked} payees linked` : ""}
      </p>
      {result.pipeline ? (
        <p className="text-[13px] text-fg-1" data-testid="import-pipeline">
          {pipelineHeadline(result.pipeline)}.{" "}
          <Link href="/items" className="text-blue-400 underline underline-offset-2">
            View in Items
          </Link>
        </p>
      ) : null}
      {result.errorGroups.length > 0 ? (
        <ul className="num list-disc space-y-0.5 pl-4 text-xs break-words text-fg-2">
          {result.errorGroups.slice(0, MAX_GROUPS_SHOWN).map((g) => (
            <li key={`${g.field}|${g.message}`}>{describeErrorGroup(g)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * "Upload a ledger / bank CSV" (docs/ASK-MODE.md §2.1): pick a file, map its columns, preview the rows (a dry run of the
 * same importer, so row errors are the real ones), then confirm the import. The file goes from the browser straight to
 * the existing `/api/ingest` route (session + CSRF); it never enters the chat or a model. Every POST is a click.
 */
export function ImportCardView({ companyId, fileKind, ledgerRows, asOf }: ImportCardUi["props"]) {
  const uid = useId();
  const [kind, setKind] = useState<Kind>(fileKind);
  const [csv, setCsv] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [preview, setPreview] = useState<IngestPreviewView | null>(null);
  const [result, setResult] = useState<IngestResultView | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState<null | "read" | "preview" | "import">(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const clearAfterFile = () => {
    setHeaders([]);
    setMapping(null);
    setPreview(null);
    setResult(null);
    setProblem(null);
  };

  async function pick(f: File | undefined) {
    clearAfterFile();
    if (!f) {
      setCsv(null);
      setFile(null);
      return;
    }
    const bad = validateCsvFile(f);
    if (bad) {
      if (inputRef.current) inputRef.current.value = "";
      setCsv(null);
      setFile(null);
      setProblem({ message: bad, details: [] });
      return;
    }
    setCsv(await f.text());
    setFile({ name: f.name, size: f.size });
  }

  async function run(step: "read" | "preview" | "import", fn: () => Promise<void>) {
    setBusy(step);
    setProblem(null);
    try {
      await fn();
    } catch (e) {
      setProblem({ message: e instanceof Error ? e.message : "The request failed. Try again.", details: [] });
    } finally {
      setBusy(null);
    }
  }

  const readColumns = () =>
    run("read", async () => {
      const { status, json } = await postIngest({ kind, csv, companyId });
      const view = interpretIngestResponse(status, json);
      if (view.type === "needsMapping") {
        setHeaders(view.headers);
        setMapping(view.suggested);
      } else if (view.type === "error") setProblem({ message: view.message, details: view.details });
      else setProblem({ message: "Unexpected response from /api/ingest", details: [] });
    });

  const runPreview = () =>
    run("preview", async () => {
      const { status, json } = await postIngest({ kind, csv, companyId, mapping, preview: true });
      const view = interpretPreviewResponse(status, json);
      if (view.type === "preview") setPreview(view.preview);
      else setProblem({ message: view.message, details: view.details });
    });

  const confirmImport = () =>
    run("import", async () => {
      const { status, json } = await postIngest({ kind, csv, companyId, mapping });
      const view = interpretIngestResponse(status, json);
      if (view.type === "done") {
        setResult(view.result);
        setPreview(null);
      } else setProblem({ message: view.type === "error" ? view.message : "Unexpected response from /api/ingest", details: view.type === "error" ? view.details : [] });
    });

  const changeMapping = (field: string, header: string) => {
    if (!mapping) return;
    setMapping(setColumn(mapping, kind, field, header || null));
    setPreview(null); // a different mapping gives different rows
  };

  const missing = mapping ? missingRequired(mapping, kind) : [];
  const dupes = mapping ? duplicateHeaders(mapping) : [];
  const step = result ? 4 : preview ? 3 : mapping ? 2 : 1;

  if (!companyId) {
    return (
      <ActionCardFrame testId="view-import-card" icon={<UploadCloud />} eyebrow="Upload a CSV" title="No company is loaded">
        <p className="px-4 py-4 text-[13px] text-fg-2 sm:px-5">Reset the demo data in Settings, then ask again. Nothing was uploaded.</p>
      </ActionCardFrame>
    );
  }

  return (
    <ActionCardFrame
      testId="view-import-card"
      icon={<UploadCloud />}
      eyebrow="Upload a CSV"
      title={`Import a ${kind === "ledger" ? "check register" : "bank-clears"} CSV`}
      meta={ledgerRows > 0 ? `${ledgerRows.toLocaleString("en-US")} ledger rows stored` : "No ledger rows yet"}
      footer={
        <p className="text-xs text-pretty text-fg-3">
          Synthetic or your own test files only. Rows dated after the demo clock ({asOf}) are rejected. Re-importing the same rows skips them as duplicates.
        </p>
      }
    >
      <div className="space-y-5 px-4 py-4 sm:px-5">
        <div className="space-y-2.5">
          <StepTitle n={1} active={step === 1}>
            Choose the file
          </StepTitle>
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">File contains</legend>
            {(["ledger", "clears"] as const).map((k) => (
              <label
                key={k}
                className={cn(
                  "glass-pill inline-flex h-8 cursor-pointer items-center gap-2 px-3 text-[13px] transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue-400",
                  kind === k ? "border-blue-400/60 text-fg-1" : "text-fg-2 hover:text-fg-1",
                )}
              >
                <input
                  type="radio"
                  name={`${uid}-kind`}
                  value={k}
                  checked={kind === k}
                  onChange={() => {
                    setKind(k);
                    clearAfterFile();
                  }}
                  className="sr-only"
                />
                {KIND_LABEL[k]}
              </label>
            ))}
          </fieldset>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            data-testid="import-file"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => void pick(e.target.files?.[0])}
          />
          {file === null ? (
            <button
              type="button"
              data-testid="import-drop"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void pick(e.dataTransfer.files?.[0]);
              }}
              className={cn(
                "flex w-full flex-col items-center justify-center gap-1.5 rounded-[14px] border border-dashed px-4 py-7 text-center outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400",
                dragging ? "border-blue-400 bg-blue-900/40" : "border-line-strong bg-ink-0/30 hover:border-blue-400/70",
              )}
            >
              <UploadCloud className="size-5 text-fg-3" strokeWidth={1.5} aria-hidden />
              <span className="text-sm text-fg-1">Drop a CSV here, or click to browse</span>
              <span className="text-xs text-fg-3">.csv only. Nothing is stored until you click Import.</span>
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border border-line bg-ink-0/30 px-3 py-2">
              <FileText className="size-4 shrink-0 text-fg-3" strokeWidth={1.5} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[13px] text-fg-1" data-testid="import-file-name">
                {file.name}
              </span>
              <span className="num shrink-0 text-xs text-fg-3">{formatFileSize(file.size)}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove file"
                onClick={() => {
                  if (inputRef.current) inputRef.current.value = "";
                  void pick(undefined);
                }}
              >
                <X strokeWidth={1.5} />
              </Button>
              {mapping === null && !result ? (
                <Button variant="outline" className="max-sm:w-full" onClick={readColumns} disabled={busy !== null} data-testid="import-read">
                  {busy === "read" ? "Reading..." : "Read columns"}
                </Button>
              ) : null}
            </div>
          )}
        </div>

        {mapping && !result ? (
          <div className="space-y-2.5">
            <StepTitle n={2} active={step === 2}>
              Map the columns
            </StepTitle>
            <p className="text-xs text-fg-3">Suggested from the headers. Required fields are marked with *.</p>
            <div className="grid gap-x-4 gap-y-2 @lg:grid-cols-2">
              {fieldsFor(kind).map((f) => {
                const id = `${uid}-map-${f.field}`;
                return (
                  <div key={f.field} className="flex items-center justify-between gap-3">
                    <label htmlFor={id} className="min-w-0 text-[13px] text-fg-2">
                      {f.label}
                      {f.required ? <span className="text-pink-400"> *</span> : null}
                    </label>
                    <select
                      id={id}
                      data-testid={`import-map-${f.field}`}
                      value={mapping.columns[f.field] ?? ""}
                      onChange={(e) => changeMapping(f.field, e.target.value)}
                      className="glass-pill h-8 w-40 max-w-[55%] shrink-0 truncate bg-ink-1 px-3 text-[13px] text-fg-1 outline-none focus-visible:outline-2 focus-visible:outline-blue-400"
                    >
                      <option value="">Not mapped</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
            {missing.length > 0 ? <p className="text-xs text-pink-400">Still needed: {missing.join(", ")}.</p> : null}
            {dupes.length > 0 ? <p className="text-xs text-pink-400">Used more than once: {dupes.join(", ")}.</p> : null}
            <Button variant="outline" onClick={runPreview} disabled={busy !== null || missing.length > 0} data-testid="import-preview-button">
              {busy === "preview" ? "Checking rows..." : preview ? "Preview again" : "Preview rows"}
            </Button>
          </div>
        ) : null}

        {preview && mapping && !result ? (
          <div className="space-y-3">
            <StepTitle n={3} active={step === 3}>
              Check and import
            </StepTitle>
            <PreviewPanel preview={preview} kind={kind} mapping={mapping} />
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={confirmImport} disabled={busy !== null || preview.validRows === 0} data-testid="import-confirm">
                {busy === "import" ? "Importing..." : `Import ${preview.validRows} ${preview.validRows === 1 ? "row" : "rows"}`}
              </Button>
              <span className="text-xs text-fg-3">{preview.errorCount > 0 ? "Rejected rows are skipped and listed again after import." : "Your click stores these rows."}</span>
            </div>
          </div>
        ) : null}

        {result && file ? <ResultPanel result={result} fileName={file.name} /> : null}
        {problem ? <ProblemBox problem={problem} /> : null}
      </div>
    </ActionCardFrame>
  );
}
