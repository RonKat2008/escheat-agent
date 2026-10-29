import { z } from "zod";
import type { Db } from "@/db/client";
import { propertyTypeEnum } from "@/db/schema";

export const PROPERTY_TYPES = propertyTypeEnum.enumValues;
export const propertyTypeSchema = z.enum(PROPERTY_TYPES);
export type PropertyTypeValue = z.infer<typeof propertyTypeSchema>;

/** A ledger line as the classifier sees it (matches the eval case item format). */
export const classifierItemSchema = z.object({
  kind: z.enum(["check", "credit", "unapplied_cash"]),
  number: z.string().nullish(),
  payee_name: z.string(),
  payee_address: z.string().nullish(),
  payee_city: z.string().nullish(),
  payee_state: z.string().nullish(),
  payee_zip: z.string().nullish(),
  amount_cents: z.number().int(),
  issue_date: z.string(),
  memo: z.string().nullish(),
  cleared_date: z.string().nullish(),
});
export type ClassifierItem = z.infer<typeof classifierItemSchema>;

export interface AgentContext {
  holder: { name?: string; stateOfIncorporation: string };
  db?: Db;
  subjectId?: string;
  companyId?: string;
  staleItemId?: string;
}
