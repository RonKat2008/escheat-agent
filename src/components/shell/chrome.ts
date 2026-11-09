/**
 * V4 shell chrome classes (docs/DESIGN-V4.md §5), shared so every round button in the top bar is identical.
 * Focus rings are steel blue (blue-400), visible on navy and on cream.
 */
export const ROUND_BUTTON =
  "glass-pill press relative inline-grid size-9 shrink-0 place-items-center text-fg-2 transition-[background-color,color,border-color] duration-150 hover:border-line-strong hover:bg-fg-1/[0.1] hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 aria-expanded:bg-fg-1/[0.1] aria-expanded:text-fg-1";

/**
 * The demo clock: the one solid cream control in the bar (the reference's white round clock button), navy text
 * (15:1). A pill rather than a circle because it carries the demo date.
 */
export const CLOCK_BUTTON =
  "press inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-fg-1 px-3 text-[13px] whitespace-nowrap text-ink-0 shadow-[0_6px_18px_-8px_rgb(244_237_224/0.5)] transition-[background-color,box-shadow] duration-150 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 aria-expanded:bg-white";
