"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4 text-blue-500" strokeWidth={1.75} />
        ),
        info: (
          <InfoIcon className="size-4 text-blue-300" strokeWidth={1.75} />
        ),
        warning: (
          <TriangleAlertIcon className="size-4 text-pink-400" strokeWidth={1.75} />
        ),
        error: (
          <OctagonXIcon className="size-4 text-pink-400" strokeWidth={1.75} />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin text-fg-3" strokeWidth={1.75} />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--color-ink-3)",
          "--normal-text": "var(--color-fg-1)",
          "--normal-border": "var(--color-line-strong)",
          "--border-radius": "10px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !shadow-[var(--shadow-overlay)] !text-[13px]",
          description: "!text-fg-2 whitespace-pre-line",
          // Info is the "system noticed something, nobody must act" voice: electric blue, not neutral (R9-07).
          info: "cn-toast-info !bg-blue-900 !border-blue-500 !text-fg-1",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
