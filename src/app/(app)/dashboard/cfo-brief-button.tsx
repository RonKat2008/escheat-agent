import { FileDown } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { CFO_BRIEF_HREF } from "@/lib/cfo-brief/href";
import { cn } from "@/lib/utils";

/** "CFO brief (PDF)": a plain download link to the one-page brief built from the same queries as this page. */
export function CfoBriefButton() {
  return (
    <a
      href={CFO_BRIEF_HREF}
      download
      data-testid="cfo-brief-download"
      title="One page for your CFO or audit committee: exposure, deadlines, late money, approvals, ledger and forecast. Synthetic data."
      className={cn(buttonVariants({ variant: "outline" }), "h-9 gap-1.5")}
    >
      <FileDown className="size-4" strokeWidth={1.75} aria-hidden />
      CFO brief (PDF)
    </a>
  );
}
