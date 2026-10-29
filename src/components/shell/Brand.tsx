import Link from "next/link";

export function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 rounded-md">
      <span aria-hidden className="grid size-7 place-items-center rounded-[8px] bg-at-risk font-mono text-[13px] font-bold text-[#0b1220]">
        E
      </span>
      <span className="text-[15px] font-semibold tracking-[-0.01em]">Escheat Agent</span>
    </Link>
  );
}
