import Link from "next/link";
import { BadgeCheck, BookOpenCheck, FileText, Inbox, MapPin, PiggyBank, type LucideIcon } from "lucide-react";
import { UnverifiedBadge } from "@/components/primitives";
import { roundedWholeUSD } from "@/components/viz/core/money-label";
import { cn } from "@/lib/utils";
import type { HeroDeadlineCard } from "./hero-deadlines";

/**
 * The pieces of the V4 dashboard stage (docs/DESIGN-V4.md §7), after the Tidewell reference: the stacked glass panel of
 * booking-style deadline rows (top right) and the five-column feature strip (bottom). Every figure is real data.
 */

/** One row: payee + amount, then the deadline ("label over big light date") and its distance from today. */
function DeadlineRow({ c }: { c: HeroDeadlineCard }) {
  return (
    <li>
      <Link
        href={c.href}
        data-testid="hero-deadline"
        data-overdue={c.overdue ? "true" : "false"}
        className="group block rounded-[16px] border border-fg-1/[0.08] bg-fg-1/[0.05] px-4 pt-3 pb-3.5 shadow-[inset_0_1px_0_rgb(244_237_224/0.06)] transition-[background-color,border-color] duration-150 hover:border-fg-1/[0.16] hover:bg-fg-1/[0.08]"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-fg-1">{c.title}</span>
            {!c.verified ? <UnverifiedBadge compact className="shrink-0" /> : null}
          </span>
          <span className="num shrink-0 text-xs text-fg-3">
            {c.state ?? "State unknown"} · {roundedWholeUSD(c.cents)}
          </span>
        </span>
        <span className="mt-2 flex items-end justify-between gap-2">
          <span className="min-w-0">
            <span className="type-label block truncate">{c.deadline.label}</span>
            <span className="num mt-0.5 block text-[26px] leading-none font-light tracking-[-0.03em] text-fg-1">{c.deadline.value}</span>
          </span>
          <span
            className={cn(
              "mb-1 inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap",
              c.overdue ? "bg-pink-500 text-black" : "border border-fg-1/[0.12] bg-fg-1/[0.08] text-fg-2",
            )}
          >
            {c.chip}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** The stacked glass panel near the top right: grab handle, a location line, two rows, and the coral tag. */
export function HeroDeadlinePanel({ where, cards, tag }: { where: string; cards: HeroDeadlineCard[]; tag: { text: string; human: boolean; href: string } }) {
  return (
    <aside aria-labelledby="hero-deadlines-h" data-testid="hero-deadlines" className="glass rounded-[22px] p-3 pt-2">
      <span aria-hidden className="mx-auto mb-2 block h-1 w-9 rounded-full bg-fg-1/25" />
      <h2 id="hero-deadlines-h" className="sr-only">
        Next deadlines
      </h2>
      <p className="flex items-center gap-1.5 px-1 pb-2.5 text-xs text-fg-2">
        <MapPin className="size-3.5 shrink-0 text-fg-3" strokeWidth={1.75} aria-hidden />
        <span className="truncate">{where}</span>
      </p>
      {cards.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {cards.map((c) => (
            <DeadlineRow key={c.key} c={c} />
          ))}
        </ul>
      ) : (
        <p className="rounded-[16px] border border-fg-1/[0.08] bg-fg-1/[0.05] px-4 py-4 text-[13px] text-fg-2">No deadlines in the next 400 days.</p>
      )}
      <Link
        href={tag.href}
        data-testid="hero-tag"
        className={cn(
          "mt-3 ml-1 inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium",
          tag.human ? "bg-pink-500 text-black hover:bg-pink-400" : "border border-blue-400/40 bg-blue-900/70 text-blue-200 hover:border-blue-400",
        )}
      >
        {tag.text}
      </Link>
    </aside>
  );
}

interface Feature {
  href: string;
  icon: LucideIcon;
  lines: [string, string];
}

/**
 * The bottom feature strip: five real places in the product, each a small line icon over a two-line muted label. The
 * first is coral with a short coral bar sitting on the divider, like the reference's active feature.
 */
export function FeatureStrip({ openCount }: { openCount: number }) {
  const features: Feature[] = [
    { href: "/items", icon: Inbox, lines: [`${openCount} stale ${openCount === 1 ? "check" : "checks"},`, "tracked from the ledger"] },
    { href: "/rules", icon: BookOpenCheck, lines: ["Deterministic rules,", "every date sourced"] },
    { href: "/approvals", icon: BadgeCheck, lines: ["Nothing is sent", "without your approval"] },
    { href: "/reports", icon: FileText, lines: ["Filings go to", "replica portals only"] },
    { href: "/recoveries", icon: PiggyBank, lines: ["Claims for money", "states hold for you"] },
  ];
  return (
    <nav aria-label="What the agent does" data-testid="feature-strip" className="relative mt-10 border-t border-fg-1/[0.12]">
      <ul className="es-scroll-x -mx-1 flex gap-1 sm:mx-0 sm:grid sm:grid-cols-5 sm:gap-4">
        {features.map((f, i) => {
          const Icon = f.icon;
          const first = i === 0;
          return (
            <li key={f.href} className="relative w-[44%] shrink-0 sm:w-auto">
              {first ? <span aria-hidden data-testid="feature-bar" className="absolute -top-px left-1 h-0.5 w-24 rounded-full bg-pink-500 sm:w-28" /> : null}
              <Link
                href={f.href}
                data-active={first ? "true" : undefined}
                className={cn(
                  "group flex flex-col gap-2 rounded-[12px] px-1 pt-4 pb-5 text-xs leading-[1.35] transition-colors duration-150",
                  first ? "text-pink-300 hover:text-fg-1" : "text-fg-2 hover:text-fg-1",
                )}
              >
                <Icon className="size-4" strokeWidth={1.5} aria-hidden />
                <span>
                  {f.lines[0]}
                  <br />
                  {f.lines[1]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
