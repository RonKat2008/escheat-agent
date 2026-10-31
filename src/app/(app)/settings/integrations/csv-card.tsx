"use client";

import { useRef, useState } from "react";
import { FileText, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  duplicateHeaders,
  fieldsFor,
  formatFileSize,
  interpretIngestResponse,
  missingRequired,
  setColumn,
  validateCsvFile,
  type IngestResponseView,
  type IngestResultView,
} from "@/lib/integrations/csv-upload";
import type { ColumnMapping } from "@/lib/ingest/mapping";
import type { IngestKind } from "@/lib/ingest/schemas";
import { IntegrationRow } from "./integration-card";

const NONE = "__none__";

export function CsvCard({ companyId }: { companyId: string | null }) {
  const [kind, setKind] = useState<IngestKind>("ledger");
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [result, setResult] = useState<IngestResultView | null>(null);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fileSize, setFileSize] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setMapping(null);
    setHeaders([]);
    setResult(null);
    setError(null);
  }

  async function submit(withMapping?: ColumnMapping) {
    if (!csv || !companyId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, csv, companyId, ...(withMapping ? { mapping: withMapping } : {}) }),
      });
      const view: IngestResponseView = interpretIngestResponse(res.status, await res.json().catch(() => ({})));
      if (view.type === "needsMapping") {
        setHeaders(view.headers);
        setMapping(view.suggested);
      } else if (view.type === "done") {
        setResult(view.result);
        setMapping(null);
      } else setError({ message: view.message, details: view.details });
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Upload failed", details: [] });
    } finally {
      setBusy(false);
    }
  }

  async function pick(f: File | undefined) {
    reset();
    const problem = f ? validateCsvFile(f) : null;
    if (f && problem) {
      // Drop the rejected file so the same one can be chosen again, and say why (announced by the role=alert below).
      if (inputRef.current) inputRef.current.value = "";
      setCsv(null);
      setFileName("");
      setFileSize(0);
      setError({ message: problem, details: [] });
      return;
    }
    setCsv(f ? await f.text() : null);
    setFileName(f?.name ?? "");
    setFileSize(f?.size ?? 0);
  }

  function clearFile() {
    if (inputRef.current) inputRef.current.value = "";
    void pick(undefined);
  }

  const missing = mapping ? missingRequired(mapping, kind) : [];
  const dupes = mapping ? duplicateHeaders(mapping) : [];

  return (
    <IntegrationRow
      title="CSV upload"
      description="Check register or bank-clear export. Columns are suggested; you confirm before anything is stored."
    >
      <div className="space-y-3">
        <label className="flex items-center gap-3 text-[13px] text-fg-2">
          <span>File contains</span>
          <Select
            value={kind}
            onValueChange={(v) => {
              setKind(v as IngestKind);
              reset();
            }}
          >
            <SelectTrigger className="w-44" aria-label="CSV kind">
              <SelectValue>{kind === "ledger" ? "Check register" : "Bank clears"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ledger">Check register</SelectItem>
              <SelectItem value="clears">Bank clears</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV file"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        {csv === null ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              // Leaving into a child (icon, caption) must not drop the highlight.
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void pick(e.dataTransfer.files?.[0]);
            }}
            className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed px-4 py-8 text-center outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 ${
              dragging ? "border-blue-400 bg-blue-900/40" : "border-line-strong bg-ink-1 hover:border-blue-400/70"
            }`}
          >
            <UploadCloud className="size-5 text-fg-3" strokeWidth={1.5} aria-hidden />
            <span className="text-sm text-fg-1">Drop a CSV here, or click to browse</span>
            <span className="text-xs text-fg-3">.csv only. Nothing is stored until you confirm the column mapping.</span>
          </button>
        ) : (
          <div className="es-rise flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line bg-ink-1 px-3 py-2">
            <FileText className="size-4 shrink-0 text-fg-3" strokeWidth={1.5} aria-hidden />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-1">{fileName}</span>
            <span className="num shrink-0 text-xs text-fg-3">{formatFileSize(fileSize)}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Remove file" onClick={clearFile}>
              <X strokeWidth={1.5} />
            </Button>
            <Button className="max-sm:w-full" onClick={() => submit()} disabled={!csv || !companyId || busy}>
              {busy && !mapping ? "Reading..." : "Suggest mapping"}
            </Button>
          </div>
        )}
      </div>

      {mapping && (
        <div className="space-y-3 pt-2">
          <p className="text-xs text-muted-foreground">
            Map columns from <span className="font-mono">{fileName}</span>. Required fields are marked.
          </p>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {fieldsFor(kind).map((f) => (
              <div key={f.field} className="flex items-center justify-between gap-3">
                <span id={`map-${f.field}`} className="text-sm">
                  {f.label}
                  {f.required && <span className="text-pink-400"> *</span>}
                </span>
                <Select
                  value={mapping.columns[f.field] ?? NONE}
                  onValueChange={(v) => setMapping(setColumn(mapping, kind, f.field, v === NONE ? null : String(v)))}
                >
                  <SelectTrigger size="sm" className="w-44" aria-labelledby={`map-${f.field}`}>
                    <SelectValue>{mapping.columns[f.field] ?? "Not mapped"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not mapped</SelectItem>
                    {headers.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          {missing.length > 0 && <p className="text-xs text-pink-400">Still needed: {missing.join(", ")}.</p>}
          {dupes.length > 0 && <p className="text-xs text-pink-400">Used more than once: {dupes.join(", ")}.</p>}
          <Button variant="outline" onClick={() => submit(mapping)} disabled={busy || missing.length > 0}>
            {busy ? "Importing..." : "Confirm mapping and import"}
          </Button>
        </div>
      )}

      {error && (
        <div role="alert" className="space-y-1 text-pink-400">
          <p>{error.message}</p>
          {error.details.length > 0 && (
            <ul className="list-disc pl-5 font-mono text-xs">
              {error.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result && (
        <div role="status" className="space-y-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Inserted</TableHead>
                <TableHead>Skipped (duplicates)</TableHead>
                <TableHead>Row errors</TableHead>
                {result.payeesLinked !== undefined && <TableHead>Payees linked</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-mono text-fg-1 tabular-nums">{result.inserted}</TableCell>
                <TableCell className="font-mono tabular-nums">{result.skipped}</TableCell>
                <TableCell className={`font-mono tabular-nums ${result.errors.length ? "text-pink-400" : ""}`}>
                  {result.errors.length}
                </TableCell>
                {result.payeesLinked !== undefined && <TableCell className="font-mono tabular-nums">{result.payeesLinked}</TableCell>}
              </TableRow>
            </TableBody>
          </Table>
          {result.errors.length > 0 && (
            <ul className="max-h-40 list-disc overflow-auto pl-5 font-mono text-xs text-muted-foreground">
              {result.errors.slice(0, 20).map((e, i) => (
                <li key={i}>
                  {e.row ? `row ${e.row}: ` : ""}
                  {e.field ? `${e.field}: ` : ""}
                  {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </IntegrationRow>
  );
}
