export type BulkDraftResult =
  | { staleItemId: string; status: "drafted"; outreachId: string; ready: boolean; problems: string[] }
  | { staleItemId: string; status: "skipped"; code?: string; reason: string }
  | { staleItemId: string; status: "failed"; reason: string };

export interface BulkOutcome<Row> {
  row: Row | undefined;
  staleItemId: string;
  result: BulkDraftResult;
}
