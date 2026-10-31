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
          <InfoIcon className="size-4 text-blue-400" strokeWidth={1.75} />
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
          "--normal-bg": "#151821",
          "--normal-text": "#f4f6fa",
          "--normal-border": "rgb(255 255 255 / 0.14)",
          "--border-radius": "10px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !shadow-[var(--shadow-overlay)] !text-[13px]",
          description: "!text-fg-2 whitespace-pre-line",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
