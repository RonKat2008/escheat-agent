"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, FastForward, RotateCcw, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { formatDate } from "@/lib/format";
import { statusMeta } from "@/components/primitives/status";

interface ClockResponse {
  today: string;
  offsetDays: number;
  transitions?: { staleItemId: string; from: string; to: string }[];
  deadlinesMoved?: number;
  error?: string;
}

type Body = { action: "advance"; days: number } | { action: "reset" } | { action: "advance_to"; date: string };

/** Demo clock: shows the simulated date; the popover fast-forwards it and recomputes timelines. */
export function DemoClock({ today, nextDeadline }: { today: string; nextDeadline: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function send(body: Body, label: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/clock", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json()) as ClockResponse;
      if (!res.ok) throw new Error(json.error ?? `Clock request failed (${res.status})`);
      const t = json.transitions ?? [];
      const counts = new Map<string, number>();
      for (const x of t) counts.set(`${x.from}>${x.to}`, (counts.get(`${x.from}>${x.to}`) ?? 0) + 1);
      const lines = [...counts].slice(0, 4).map(([k, n]) => {
        const [from = "", to = ""] = k.split(">");
        return `${n} × ${statusMeta(from).label} → ${statusMeta(to).label}`;
      });
      toast.success(`${label}: demo date is now ${formatDate(json.today)}`, {
        description: lines.length ? lines.join("\n") : "No status changes.",
      });
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error("Could not move the demo clock", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || pending;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Demo clock, ${formatDate(today)}. Open controls`}
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-xs transition-colors duration-150 hover:border-strong hover:bg-raised"
          />
        }
      >
        <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="hidden text-muted-foreground sm:inline">Demo date</span>
        <span data-testid="demo-date" className="font-mono text-[13px] text-foreground">
          {today}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <PopoverTitle>Demo clock</PopoverTitle>
        <p className="mt-1 mb-3 text-xs text-muted-foreground">Move simulated time forward. Deadlines and statuses recompute.</p>
        <div className="grid grid-cols-3 gap-1.5">
          {([["+30d", 30, "30 days"], ["+90d", 90, "90 days"], ["+1y", 365, "1 year"]] as const).map(([label, days, long]) => (
            <Button key={label} size="sm" variant="outline" disabled={disabled} onClick={() => send({ action: "advance", days }, `+${long}`)} className="font-mono">
              {label}
            </Button>
          ))}
        </div>
        <div className="mt-1.5 grid gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || !nextDeadline}
            onClick={() => nextDeadline && send({ action: "advance_to", date: nextDeadline }, "Next deadline")}
            className="justify-start"
          >
            <SkipForward className="size-3.5" aria-hidden />
            {nextDeadline ? `Jump to next deadline (${formatDate(nextDeadline, { year: false })})` : "No upcoming deadline"}
          </Button>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => send({ action: "reset" }, "Reset")} className="justify-start text-muted-foreground">
            <RotateCcw className="size-3.5" aria-hidden />
            Reset to start
          </Button>
        </div>
        <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-2 text-xs text-muted-foreground">
          <FastForward className="size-3" aria-hidden />
          {disabled ? "Recomputing timelines…" : `Today is ${formatDate(today)}`}
        </div>
      </PopoverContent>
    </Popover>
  );
}
