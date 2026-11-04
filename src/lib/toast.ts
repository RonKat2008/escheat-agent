import type { ExternalToast } from "sonner";

/**
 * Lazy toast API. `sonner` (~10 KB gz) is not part of a route's first-load JS: the outlet (components/shell/ToastOutlet)
 * loads it after the page has loaded, and these calls wait for that, so a toast raised early is delayed, never lost.
 */
let markReady: () => void = () => undefined;
const outletReady = new Promise<void>((resolve) => {
  markReady = resolve;
});

/** Called by the outlet once the real <Toaster /> is mounted. */
export function toastOutletMounted(): void {
  markReady();
}

async function fire(kind: "success" | "error" | "info", message: string, data?: ExternalToast): Promise<void> {
  await outletReady;
  const { toast } = await import("sonner");
  toast[kind](message, data);
}

export const toast = {
  success: (message: string, data?: ExternalToast): void => void fire("success", message, data),
  /** Blue: something happened that is worth knowing, nobody has to act (pink is reserved for "a person must act"). */
  info: (message: string, data?: ExternalToast): void => void fire("info", message, data),
  error: (message: string, data?: ExternalToast): void => void fire("error", message, data),
};
