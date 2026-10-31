import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-[13px] font-medium whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 ease-out outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:not-aria-[haspopup]:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-pink-500 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /** The one primary action per view: solid blue-600, white text (5.25:1). */
        default: "bg-blue-600 text-white hover:bg-[#3369ff] active:bg-blue-700 disabled:bg-ink-3 disabled:text-fg-3 disabled:opacity-100",
        /** Secondary: 1px border on ink-2. */
        outline:
          "border-line-hover bg-ink-2 text-fg-1 hover:border-line-strong hover:bg-ink-3 aria-expanded:bg-ink-3",
        secondary:
          "border-line-hover bg-ink-2 text-fg-1 hover:border-line-strong hover:bg-ink-3 aria-expanded:bg-ink-3",
        ghost:
          "text-fg-2 hover:bg-ink-3 hover:text-fg-1 aria-expanded:bg-ink-3 aria-expanded:text-fg-1",
        /** Destructive: pink outline, pink text; never a fill. */
        destructive:
          "border-pink-500/60 bg-transparent text-pink-400 hover:bg-pink-900/50 hover:text-pink-300 focus-visible:outline-pink-400",
        link: "h-auto! px-0! text-blue-400 underline-offset-4 hover:text-blue-300 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 rounded-[5px] px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-[13px] has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-4 text-sm has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs": "size-6 rounded-[5px] [&_svg:not([class*='size-'])]:size-3",
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
