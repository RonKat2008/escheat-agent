import { redirect } from "next/navigation";

/** Integrations is the only settings surface in this prototype, so the bare /settings path lands there. */
export default function Page(): never {
  redirect("/settings/integrations");
}
