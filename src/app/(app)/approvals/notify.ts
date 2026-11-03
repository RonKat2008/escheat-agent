import { toast, type ExternalToast } from "sonner";

/**
 * Toasts from the approvals desk (R3-02). They appear top-centre, well away from the sticky action bar at the bottom,
 * so they can never sit over Send or Approve (and a pointer resting on Send never pauses one), and they always
 * auto-dismiss.
 */
export const APPROVALS_TOAST: ExternalToast = { position: "top-center", duration: 4000 };

export const notify = {
  success: (title: string, opts: ExternalToast = {}) => toast.success(title, { ...APPROVALS_TOAST, ...opts }),
  warning: (title: string, opts: ExternalToast = {}) => toast.warning(title, { ...APPROVALS_TOAST, ...opts }),
  error: (title: string, opts: ExternalToast = {}) => toast.error(title, { ...APPROVALS_TOAST, ...opts }),
};
