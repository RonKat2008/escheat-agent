import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/** Page title (20px/600), one line of context, actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0 space-y-1">
        <h1 id="page-heading" className="text-xl leading-7 font-semibold tracking-[-0.015em] text-fg-1">
          {title}
        </h1>
        {description ? <p className="max-w-2xl text-sm text-fg-2">{description}</p> : null}
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

/** A bordered panel for real objects (a table, a document, a form). 1px border, no shadow. */
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
    <Tag className={cn("rounded-xl border border-line bg-ink-2", className)}>
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
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div role="status" className={cn("flex flex-col items-start gap-1.5 py-6", className)}>
      <p className="text-sm font-medium text-fg-1">{title}</p>
      {description ? <p className="max-w-md text-sm text-fg-2">{description}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
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
    <div role="alert" className={cn("flex items-start gap-3 rounded-xl border border-pink-500/60 bg-pink-900/40 p-4", className)}>
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-pink-400" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-fg-1">{title}</p>
        {message ? <p className="text-sm break-words text-fg-2">{message}</p> : null}
        {action ? <div className="pt-2">{action}</div> : null}
      </div>
    </div>
  );
}

/** Keyboard key chip. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-line bg-ink-2 px-1 font-mono text-[11px] leading-none text-fg-2", className)}>
      {children}
    </kbd>
  );
}
