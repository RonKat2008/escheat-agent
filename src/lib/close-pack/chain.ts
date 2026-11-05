/** The audit chain summary the tie-out reports: the stored chain's length and head hash (see src/lib/audit/chain-db.ts). */
export interface AuditChain {
  length: number;
  head: string;
}
