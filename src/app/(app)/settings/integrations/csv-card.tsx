"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  duplicateHeaders,
  fieldsFor,
  interpretIngestResponse,
  missingRequired,
  setColumn,
  type IngestResponseView,
  type IngestResultView,
} from "@/lib/integrations/csv-upload";
import type { ColumnMapping } from "@/lib/ingest/mapping";
import type { IngestKind } from "@/lib/ingest/schemas";
import { IntegrationCard } from "./integration-card";

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

  const missing = mapping ? missingRequired(mapping, kind) : [];
  const dupes = mapping ? duplicateHeaders(mapping) : [];

  return (
    <IntegrationCard
      title="CSV upload"
      description="Check register or bank-clear export. Columns are suggested; you confirm before anything is stored."
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">File contains</span>
          <Select
            value={kind}
            onValueChange={(v) => {
              setKind(v as IngestKind);
              reset();
            }}
          >
            <SelectTrigger className="w-44" aria-label="CSV kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ledger">Check register</SelectItem>
              <SelectItem value="clears">Bank clears</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">CSV file</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="block text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-foreground"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              reset();
              setCsv(f ? await f.text() : null);
              setFileName(f?.name ?? "");
            }}
          />
        </label>
        <Button onClick={() => submit()} disabled={!csv || !companyId || busy}>
          {busy && !mapping ? "Reading..." : "Suggest mapping"}
        </Button>
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
                    <SelectValue />
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
          <Button onClick={() => submit(mapping)} disabled={busy || missing.length > 0}>
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
    </IntegrationCard>
  );
}
