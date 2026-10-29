import Link from "next/link";
import { EmptyState } from "@/components/primitives";

export default function NotFound() {
  return (
    <div className="rounded-[14px] border border-border bg-surface p-6">
      <EmptyState title="Run not found" description="It may have been cleared with the demo data." action={<Link href="/runs" className="text-sm underline underline-offset-2">Back to all runs</Link>} />
    </div>
  );
}
