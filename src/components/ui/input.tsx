import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-md border border-line-hover bg-ink-2 px-2.5 py-1 text-base text-fg-1 transition-[border-color,background-color] duration-150 outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-fg-1 placeholder:text-fg-3 hover:border-line-strong focus-visible:border-blue-400 focus-visible:outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-pink-500 md:text-[13px]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
