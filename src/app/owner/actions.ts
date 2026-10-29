"use server";

import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { getOutreachDb } from "@/lib/outreach/db";
import { OWNER_INTENTS, recordOwnerResponse } from "@/lib/outreach/owner-response";
import { OwnerTokenError } from "@/lib/outreach/tokens";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

/** Public server action. Everything is re-validated server-side; the token is the credential. */
export async function submitOwnerResponse(formData: FormData): Promise<void> {
  const token = str(formData, "token");
  const intent = str(formData, "intent");
  const base = `/owner/${encodeURIComponent(token)}`;
  let dest: string;
  try {
    if (!(OWNER_INTENTS as readonly string[]).includes(intent)) throw new ZodError([]);
    const note = str(formData, "note");
    const hasAddress = intent === "confirm_address";
    await recordOwnerResponse(await getOutreachDb(), token, {
      intent,
      note: note || undefined,
      address: hasAddress
        ? { line1: str(formData, "line1"), city: str(formData, "city"), state: str(formData, "state"), zip: str(formData, "zip") }
        : undefined,
    });
    dest = `${base}?done=${intent}`;
  } catch (e) {
    if (e instanceof ZodError) dest = `${base}?error=${intent === "confirm_address" ? "address" : "invalid"}`;
    else if (e instanceof OwnerTokenError) dest = base; // the page explains why the link no longer works
    else {
      console.error("[owner] response failed", e);
      dest = `${base}?error=failed`;
    }
  }
  redirect(dest);
}
