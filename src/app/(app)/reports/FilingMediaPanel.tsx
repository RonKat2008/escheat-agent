import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { InstrumentLabel } from "@/components/primitives";
import type { FilingMedia } from "./filing-media";

/** The filing agent's screenshots and session video, inline in the File step. Straight from the run's stored artifacts. */
export function FilingMediaPanel({ media }: { media: FilingMedia }) {
  return (
    <section aria-labelledby="filing-media-h" className="min-w-0 border-t border-line pt-5" data-testid="filing-media">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <InstrumentLabel as="h3" id="filing-media-h">
          What the filing agent saw (replica portal)
        </InstrumentLabel>
        <Link href={`/runs/${media.runId}`} className="inline-flex items-center gap-1 rounded-sm text-[13px] text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline">
          Open the full run <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      {media.video ? (
        <video
          controls
          preload="none"
          src={media.video}
          className="mb-4 aspect-video w-full max-w-3xl rounded-md border border-line bg-ink-1"
          data-testid="filing-video"
          aria-label="Session recording of the filing agent driving the replica portal"
        >
          <a href={media.video}>Download the session recording</a>
        </video>
      ) : null}
      {media.shots.length > 0 ? (
        <ol className="flex snap-x gap-3 overflow-x-auto pb-2 [contain:inline-size]" tabIndex={0} aria-label="Filing agent screenshots, oldest first (scrolls sideways)" data-testid="filing-shots">
          {media.shots.map((s) => (
            <li key={s.step} className="w-56 shrink-0 snap-start">
              <a href={s.src} target="_blank" rel="noopener noreferrer" className="block rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400">
                {/* eslint-disable-next-line @next/next/no-img-element -- authenticated artifact route */}
                <img src={s.src} alt={`Step ${s.step + 1}: ${s.label}`} width={224} height={140} loading="lazy" className="h-[140px] w-56 rounded-md border border-line bg-ink-1 object-cover object-top" />
              </a>
              <p className="mt-1 line-clamp-2 text-xs text-fg-3">
                <span className="num font-mono">#{s.step + 1}</span> {s.label}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
