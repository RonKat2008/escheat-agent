import { PageHeader } from "@/components/primitives";

export function AuditSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading the audit drill">
      <div className="h-[148px] rounded-[10px] border border-line bg-ink-2" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        <div className="h-[220px] animate-pulse rounded-[10px] border border-line bg-ink-2 motion-reduce:animate-none" />
        <div className="h-[220px] animate-pulse rounded-[10px] border border-line bg-ink-2 motion-reduce:animate-none" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="h-[260px] animate-pulse rounded-[10px] border border-line bg-ink-1 motion-reduce:animate-none" />
      ))}
    </div>
  );
}

export default function Loading() {
  return (
    <div>
      <PageHeader eyebrow="Audit drill" title="Are we ready for an audit?" />
      <AuditSkeleton />
    </div>
  );
}
