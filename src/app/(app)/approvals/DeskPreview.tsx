import { ExternalLink } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The exact document the owner receives, laid on the desk as paper (DESIGN-V3 §6.6, `.es-desk`): a US Letter sheet
 * at its real 8.5 × 11 proportion with a second sheet under it, so it reads as a document and not a screenshot.
 * The preview route renders the stored draft byte for byte (sandboxed, no scripts).
 */
export function DeskPreview({
  outreachId,
  channel,
  channelLabel,
  icon: Icon,
  contentSha256,
}: {
  outreachId: string;
  channel: "letter" | "email" | "voice";
  channelLabel: string;
  icon: LucideIcon;
  contentSha256: string;
}) {
  const src = `/api/outreach/${outreachId}/preview`;
  const isLetter = channel === "letter";
  return (
    <figure className="overflow-hidden rounded-[14px] border border-line bg-ink-1" data-testid="letter-preview">
      <figcaption className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2 text-xs text-fg-3">
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
          <span className="truncate">{isLetter ? "As mailed: US Letter, 8.5 × 11 in" : channel === "email" ? "As delivered: HTML email" : "Call script, as read"}</span>
        </span>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-sm text-fg-2 underline-offset-2 transition-colors duration-150 hover:text-fg-1 hover:underline"
        >
          Open full size <ExternalLink className="size-3" strokeWidth={1.5} aria-hidden />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </figcaption>
      <div className="es-desk px-3 pt-6 pb-8 sm:px-10 sm:pt-9 sm:pb-11">
        <div className={isLetter ? "relative mx-auto w-full max-w-[640px]" : "relative mx-auto w-full max-w-[680px]"}>
          {/* The sheet underneath: one offset edge is enough to read as paper. */}
          <span aria-hidden className="absolute inset-x-2 top-2 -bottom-2 rotate-[0.6deg] rounded-[2px] bg-fg-2/80" />
          <div className={isLetter ? "relative aspect-[8.5/11] w-full" : "relative h-[min(560px,64vh)] w-full"}>
            <iframe
              title={`${channelLabel} preview`}
              src={src}
              sandbox=""
              loading="lazy"
              className="absolute inset-0 block h-full w-full rounded-[2px] bg-white shadow-[var(--shadow-float)]"
            />
          </div>
        </div>
        <p className="mx-auto mt-5 flex max-w-[640px] items-center justify-between gap-3 text-[11px] text-fg-3">
          <span className="instrument-label">{isLetter ? "Letter · scrolls inside the page" : channel === "email" ? "One message" : "Script"}</span>
          <span className="font-mono">sha256 {contentSha256.slice(0, 12)}</span>
        </p>
      </div>
    </figure>
  );
}
