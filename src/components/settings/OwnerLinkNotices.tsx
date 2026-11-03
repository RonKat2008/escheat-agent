import { CircleAlert, CircleCheck } from "lucide-react";
import { ownerLinkNotices, type OwnerLinkState } from "@/lib/settings/operator-copy";
import { ConfigNames, TechnicalDetails } from "./TechnicalDetails";

/**
 * R3-14: owner reply-link readiness in operator language. The env-var names live only in the collapsed disclosure;
 * the secret itself is never read into the UI (the server passes booleans).
 */
export function OwnerLinkNotices({ state }: { state: OwnerLinkState }) {
  const notices = ownerLinkNotices(state);
  return (
    <ul data-testid="owner-link-notices">
      {notices.map((n) => (
        <li key={n.id} className="border-b border-line py-4 first:pt-0">
          <p className="flex items-start gap-2 text-[13px] leading-5 text-fg-1">
            {n.ok ? (
              <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-blue-400" strokeWidth={1.5} aria-hidden />
            ) : (
              <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-fg-2" strokeWidth={1.5} aria-hidden />
            )}
            <span>
              <span className="font-medium">{n.title}. </span>
              <span className="text-fg-2">{n.plain}</span>
            </span>
          </p>
          <TechnicalDetails className="ml-5.5">
            <ConfigNames names={[n.configName]} intro={n.technical} />
          </TechnicalDetails>
        </li>
      ))}
    </ul>
  );
}
