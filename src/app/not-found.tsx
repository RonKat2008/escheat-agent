import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { StatusPage } from "./_status/StatusPage";

export default function NotFound() {
  return (
    <StatusPage
      code="404"
      title="That page does not exist"
      action={
        <Link href="/dashboard" className={buttonVariants({ size: "lg" })}>
          Back to dashboard
        </Link>
      }
    >
      <p>The link may be old, or the page was cleared with the demo data.</p>
    </StatusPage>
  );
}
