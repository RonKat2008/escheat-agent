import { z } from "zod";
import { DATE_FORMATS, type DateFormat } from "./values";
import type { IngestKind } from "./schemas";

export const FIELD_TYPES = ["string", "amount", "date", "boolean"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** JSON-safe part of a column mapping (what the API accepts). */
export const ColumnMappingSchema = z.object({
  /** canonical field -> source header (matched case/whitespace-insensitively) */
  columns: z.record(z.string(), z.string()),
  /** how to interpret each canonical field; unlisted fields are strings */
  types: z.record(z.string(), z.enum(FIELD_TYPES)).optional(),
  /** canonical fields whose header MUST exist in the file; default = every mapped field */
  required: z.array(z.string()).optional(),
  dateFormat: z.enum(DATE_FORMATS as unknown as [DateFormat, ...DateFormat[]]).optional(),
});

export type ColumnMapping = z.infer<typeof ColumnMappingSchema> & {
  /** in-process only: custom per-field transforms run instead of the built-in `types` parser */
  transforms?: Record<string, (raw: string) => unknown>;
};

export const syntheticLedgerMapping: ColumnMapping = {
  columns: {
    kind: "kind",
    number: "number",
    payeeName: "payee_name",
    payeeAddress: "payee_address",
    payeeCity: "payee_city",
    payeeState: "payee_state",
    payeeZip: "payee_zip",
    amount: "amount",
    issueDate: "issue_date",
    voided: "voided",
    memo: "memo",
  },
  types: { amount: "amount", issueDate: "date", voided: "boolean" },
  required: ["payeeName", "amount", "issueDate"],
  dateFormat: "YYYY-MM-DD",
};

export const syntheticClearsMapping: ColumnMapping = {
  columns: {
    checkNumber: "check_number",
    amount: "amount",
    clearedDate: "cleared_date",
    description: "description",
  },
  types: { amount: "amount", clearedDate: "date" },
  required: ["amount", "clearedDate"],
  dateFormat: "YYYY-MM-DD",
};

/** Normalize a header for matching: lowercase, collapse whitespace. */
export function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

const squash = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

interface FieldSpec {
  field: string;
  type: FieldType;
  required: boolean;
  synonyms: string[]; // squashed, highest priority first
}

const LEDGER_SPECS: FieldSpec[] = [
  { field: "kind", type: "string", required: false, synonyms: ["kind", "type", "itemtype", "doctype", "transactiontype", "category"] },
  { field: "number", type: "string", required: false, synonyms: ["number", "checknumber", "checkno", "checknum", "check", "chk", "chkno", "chknum", "chknumber", "refno", "reference", "ref", "documentnumber", "docno"] },
  { field: "payeeName", type: "string", required: true, synonyms: ["payeename", "payee", "vendorname", "vendor", "payto", "name", "payableto", "customer"] },
  { field: "payeeAddress", type: "string", required: false, synonyms: ["payeeaddress", "address", "address1", "addressline", "street", "vendoraddress", "addr"] },
  { field: "payeeCity", type: "string", required: false, synonyms: ["payeecity", "city", "town"] },
  { field: "payeeState", type: "string", required: false, synonyms: ["payeestate", "state", "st", "province"] },
  { field: "payeeZip", type: "string", required: false, synonyms: ["payeezip", "zip", "zipcode", "postalcode", "postcode"] },
  { field: "amount", type: "amount", required: true, synonyms: ["amount", "checkamount", "amt", "total", "value"] },
  { field: "issueDate", type: "date", required: true, synonyms: ["issuedate", "dateissued", "checkdate", "issued", "date", "transactiondate", "postdate", "postingdate"] },
  { field: "voided", type: "boolean", required: false, synonyms: ["voided", "void", "isvoid", "isvoided", "voidflag"] },
  { field: "memo", type: "string", required: false, synonyms: ["memo", "description", "note", "notes", "comment", "comments"] },
];

const CLEARS_SPECS: FieldSpec[] = [
  { field: "checkNumber", type: "string", required: false, synonyms: ["checknumber", "checkno", "checknum", "check", "chk", "chkno", "chknum", "number", "serial", "serialnumber", "refno", "reference", "ref"] },
  { field: "amount", type: "amount", required: true, synonyms: ["amount", "amt", "debit", "withdrawal", "total", "value"] },
  { field: "clearedDate", type: "date", required: true, synonyms: ["cleareddate", "clearingdate", "datecleared", "posteddate", "postdate", "postingdate", "cleared", "date", "transactiondate"] },
  { field: "description", type: "string", required: false, synonyms: ["description", "desc", "memo", "details", "narrative", "payee"] },
];

const SPECS: Record<IngestKind, FieldSpec[]> = { ledger: LEDGER_SPECS, clears: CLEARS_SPECS };

/** Canonical fields a mapping must supply for this kind. */
export function requiredFields(kind: IngestKind): string[] {
  return SPECS[kind].filter((s) => s.required).map((s) => s.field);
}

/**
 * Heuristic header -> canonical field mapper. Exact synonym matches win, then
 * substring matches (synonyms >= 4 chars). Each header is used at most once.
 * Fields with no plausible header are omitted; compare with `requiredFields`.
 */
export function suggestMapping(headers: string[], kind: IngestKind = "ledger"): ColumnMapping {
  const specs = SPECS[kind];
  const squashed = headers.map(squash);
  const used = new Set<number>();
  const columns: Record<string, string> = {};

  const claim = (spec: FieldSpec, test: (h: string, syn: string) => boolean) => {
    for (const syn of spec.synonyms) {
      const idx = squashed.findIndex((h, i) => !used.has(i) && h !== "" && test(h, syn));
      if (idx >= 0) {
        used.add(idx);
        columns[spec.field] = headers[idx]!.trim();
        return;
      }
    }
  };
  for (const spec of specs) claim(spec, (h, syn) => h === syn);
  for (const spec of specs) {
    if (columns[spec.field]) continue;
    claim(spec, (h, syn) => syn.length >= 4 && h.includes(syn));
  }

  const types: Record<string, FieldType> = {};
  for (const spec of specs) if (columns[spec.field] && spec.type !== "string") types[spec.field] = spec.type;
  return { columns, types, required: specs.filter((s) => s.required).map((s) => s.field), dateFormat: "auto" };
}
