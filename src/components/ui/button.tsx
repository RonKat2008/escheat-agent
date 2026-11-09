import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/** Coral pill, navy text. Shared with ActionButton's approve/primary so every "a person acts" button is the same. */
export const PRIMARY =
  "bg-pink-500 text-ink-0 font-medium shadow-[0_8px_24px_-10px_rgb(255_107_91/0.7),inset_0_1px_0_rgb(255_255_255/0.25)] hover:bg-pink-400 active:bg-pink-600 disabled:bg-ink-3 disabled:text-fg-3 disabled:shadow-none disabled:opacity-100";
/** Glass pill: the secondary action. */
export const SECONDARY =
  "border-line-hover bg-fg-1/[0.06] text-fg-1 shadow-[inset_0_1px_0_rgb(244_237_224/0.08)] backdrop-blur-md hover:border-line-strong hover:bg-fg-1/[0.1] aria-expanded:bg-fg-1/[0.1]";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border border-transparent bg-clip-padding text-[13px] font-medium whitespace-nowrap transition-[background-color,border-color,color,transform,filter] duration-150 ease-out outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:not-aria-[haspopup]:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-pink-500 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /** V4: the one primary action per view is a coral pill with navy text (6.5:1), soft coral glow. */
        default: PRIMARY,
        /** Secondary: 1px border on ink-2. */
        /** Secondary: a glass pill (cream hairline, translucent navy, blurred). */
        outline: SECONDARY,
        secondary: SECONDARY,
        ghost:
          "text-fg-2 hover:bg-fg-1/[0.07] hover:text-fg-1 aria-expanded:bg-fg-1/[0.07] aria-expanded:text-fg-1",
        /** Destructive: pink outline, pink text; never a fill. */
        destructive:
          "border-pink-500/60 bg-transparent text-pink-400 hover:bg-pink-900/50 hover:text-pink-300 focus-visible:outline-pink-400",
        /** V3 names (§7). `primary` = default; `danger-outline` = destructive. */
        primary: PRIMARY,
        "danger-outline":
          "border-pink-500/60 bg-transparent text-pink-400 hover:bg-pink-900/50 hover:text-pink-300 focus-visible:outline-pink-400",
        /** Ghost text link (pair with a ↗ for navigational CTAs). */
        link: "h-auto! rounded-sm! px-0! text-fg-1 underline decoration-fg-1/30 underline-offset-4 hover:decoration-fg-1",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-[13px] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-4 text-sm has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        /** V3 sizes (§7): 28 / 32 / 40. */
        "28": "h-7 gap-1 px-2.5 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        "32": "h-8 gap-1.5 px-3",
        "40": "h-10 gap-2 px-4 text-sm",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
