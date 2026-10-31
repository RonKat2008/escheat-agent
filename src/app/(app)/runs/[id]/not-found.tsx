import Link from "next/link";
import { EmptyState } from "@/components/primitives";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="border-t border-line">
      <EmptyState
        title="Run not found"
        description="It may have been cleared with the demo data."
        action={
          <Link href="/runs" className={buttonVariants({ variant: "outline" })}>
            Back to all runs
          </Link>
        }
      />
    </div>
  );
}
