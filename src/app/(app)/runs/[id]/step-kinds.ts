import {
  Camera,
  CircleCheck,
  CircleDashed,
  Compass,
  FlaskConical,
  Info,
  MousePointerClick,
  OctagonX,
  PauseCircle,
  Quote,
  RotateCcw,
  ScanText,
  Send,
  ShieldBan,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/** How a step kind reads in the trace: icon + label, colour only reinforces (blue = done, pink = needs attention / failed). */
export interface KindMeta {
  label: string;
  icon: LucideIcon;
  /** icon colour */
  tint: string;
  /** node ring colour on the rail */
  ring: string;
  /** routine, repetitive events recede to fg-2 so the meaningful steps lead */
  quiet?: boolean;
}

const NEUTRAL = { tint: "text-fg-3", ring: "ring-line-hover" };
const ACTIVE = { tint: "text-blue-400", ring: "ring-blue-800" };
const DONE = { tint: "text-blue-500", ring: "ring-blue-700" };
const ATTN = { tint: "text-pink-400", ring: "ring-pink-700" };

export const KIND_META: Record<string, KindMeta> = {
  navigate: { label: "Navigate", icon: Compass, ...ACTIVE },
  action: { label: "Action", icon: MousePointerClick, ...ACTIVE },
  extract: { label: "Extract", icon: ScanText, ...ACTIVE },
  screenshot: { label: "Screenshot", icon: Camera, ...NEUTRAL },
  guard_blocked: { label: "Guard blocked", icon: ShieldBan, ...NEUTRAL, quiet: true },
  info: { label: "Info", icon: Info, ...NEUTRAL },
  done: { label: "Done", icon: CircleCheck, ...DONE },
  error: { label: "Error", icon: OctagonX, ...ATTN },
  paused: { label: "Paused", icon: PauseCircle, ...ATTN },
  approval: { label: "Approval", icon: PauseCircle, ...ATTN },
  request: { label: "Request", icon: Send, ...ACTIVE },
  tool_call: { label: "Tool call", icon: Wrench, ...ACTIVE },
  research_done: { label: "Research done", icon: FlaskConical, ...DONE },
  result: { label: "Result", icon: CircleCheck, ...DONE },
  citations: { label: "Citations", icon: Quote, ...NEUTRAL },
  retry: { label: "Retry", icon: RotateCcw, ...ATTN },
};

export function kindMeta(kind: string): KindMeta {
  return KIND_META[kind] ?? { label: kind.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), icon: CircleDashed, ...NEUTRAL };
}
