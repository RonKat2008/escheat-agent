import type { ReactNode } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/** Page title (V4 display: large, light, tight-tracked cream), one line of muted context, actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Instrument-label eyebrow above the title (§6 global). */
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-9 flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="min-w-0 space-y-2">
        {eyebrow ? <p className="instrument-label">{eyebrow}</p> : null}
        <h1 id="page-heading" className="type-display text-[clamp(2rem,1.45rem+1.9vw,3.25rem)]">
          {title}
        </h1>
        {description ? <p className="max-w-2xl text-[15px] leading-6 text-fg-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * Page-level grouping without a box: hairline above, a sentence-case heading, optional meta/action on the right.
 * Use this for sections of a page; use <SectionCard/> only for things that are objects.
 */
export function Section({
  title,
  meta,
  action,
  children,
  className,
  id,
  "aria-label": ariaLabel,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  "aria-label"?: string;
}) {
  return (
    <section aria-label={ariaLabel} aria-labelledby={!ariaLabel && id ? `${id}-h` : undefined} className={cn("min-w-0 border-t border-line pt-5", className)}>
      {title || action || meta ? (
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            {title ? (
              <h2 id={id ? `${id}-h` : undefined} className="text-sm font-medium whitespace-nowrap text-fg-1">
                {title}
              </h2>
            ) : null}
            {meta ? <span className="text-[13px] text-fg-3">{meta}</span> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * A secondary, rarely used Section, folded: a native <details> (closed unless `open`) whose summary reads like a
 * Section header plus a chevron. Keeps the page calm without removing anything; `id` anchors still work.
 */
export function FoldSection({
  title,
  meta,
  children,
  className,
  id,
  open = false,
  testId,
}: {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  open?: boolean;
  testId?: string;
}) {
  return (
    <details id={id} open={open} data-testid={testId} className={cn("group/fold min-w-0 border-t border-line pt-5", className)}>
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 rounded-sm outline-offset-4 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span className="text-sm font-medium whitespace-nowrap text-fg-1">{title}</span>
          {meta ? <span className="text-[13px] text-fg-3">{meta}</span> : null}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-fg-3 transition-colors duration-150 group-hover/fold:text-fg-1">
          <span className="group-open/fold:hidden">Show</span>
          <span className="hidden group-open/fold:inline">Hide</span>
          <ChevronDown aria-hidden className="size-3.5 transition-transform duration-200 group-open/fold:rotate-180" strokeWidth={1.5} />
        </span>
      </summary>
      <div className="pt-4">{children}</div>
    </details>
  );
}

/** A glass panel for real objects (a table, a document, a form): translucent navy, cream hairline, 18px radius. */
export function SectionCard({
  title,
  action,
  children,
  className,
  bodyClassName,
  as: Tag = "section",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: "section" | "div";
}) {
  return (
    <Tag className={cn("glass rounded-[18px]", className)}>
      {title || action ? (
        <div className="flex items-center justify-between gap-3 px-4 pt-3.5">
          {title ? <h2 className="text-sm leading-6 font-medium text-fg-1">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      <div className={cn("px-4 pt-3 pb-4", bodyClassName)}>{children}</div>
    </Tag>
  );
}

/** States the fact, says what will appear, offers the next action. Left-aligned, no illustration. */
export function EmptyState({
  title,
  description,
  action,
  eyebrow,
  ghost,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** Instrument-label eyebrow (§5.6). */
  eyebrow?: ReactNode;
  /** The future layout, drawn at 30% opacity over the vault grid (§5.6). Decorative: hidden from assistive tech. */
  ghost?: ReactNode;
  className?: string;
}) {
  const body = (
    <>
      {eyebrow ? <p className="instrument-label mb-1">{eyebrow}</p> : null}
      <p className="text-sm font-medium text-fg-1">{title}</p>
      {description ? <p className="max-w-md text-sm text-fg-2">{description}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </>
  );
  if (!ghost) {
    return (
      <div role="status" className={cn("flex flex-col items-start gap-1.5 py-6", className)}>
        {body}
      </div>
    );
  }
  return (
    <div role="status" className={cn("glass relative isolate overflow-hidden rounded-[18px] px-5 py-8", className)}>
      <div aria-hidden className="vault-floor absolute inset-0 -z-10" />
      <div aria-hidden inert className="pointer-events-none absolute inset-0 -z-10 p-5 opacity-30 select-none">
        {ghost}
      </div>
      <div className="flex flex-col items-start gap-1.5">{body}</div>
    </div>
  );
}

/** Error: pink outline + tinted block + alert icon + a sentence. */
export function ErrorState({
  title = "Something went wrong",
  message,
  action,
  className,
}: {
  title?: string;
  message?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-[18px] border border-pink-500/60 bg-pink-900/60 p-4 backdrop-blur-md", className)}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-pink-400" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-fg-1">{title}</p>
        {message ? <p className="text-sm break-words text-fg-2">{message}</p> : null}
        {action ? <div className="pt-2">{action}</div> : null}
      </div>
    </div>
  );
}

/** Keyboard key chip. Kept for existing imports; the canonical chip is components/ui/kbd. */
export { Kbd } from "@/components/ui/kbd";
