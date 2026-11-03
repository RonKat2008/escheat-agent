import Link from "next/link";
import { ArrowUpRight, MapPinOff } from "lucide-react";
import { ActionButton } from "@/components/b/ActionButton";

/**
 * R2-08: a letter blocked by a missing owner address offers its fix. The only write path for an owner address is the
 * owner's own answer on the response page (it updates the address on file), so the fix is to reach the owner on
 * another channel first, then recompose this letter. Nothing here edits an address on the owner's behalf.
 */
export function AddressFix({
  ownerName,
  addressOnFile,
  staleItemId,
  emailDraftKey,
  pending,
  onDraftEmail,
  onOpenEmail,
}: {
  ownerName: string;
  addressOnFile: string;
  staleItemId: string;
  /** Queue key of an existing email draft for this owner, if there is one. */
  emailDraftKey: string | null;
  pending: boolean;
  onDraftEmail: () => void;
  onOpenEmail: (key: string) => void;
}) {
  return (
    <section aria-labelledby="address-fix" data-testid="address-fix" className="rounded-[10px] border border-pink-700 bg-pink-950 p-4">
      <h3 id="address-fix" className="flex items-center gap-2 text-[13px] font-medium text-fg-1">
        <MapPinOff className="size-4 text-pink-400" strokeWidth={1.75} aria-hidden />
        No complete mailing address for {ownerName}
      </h3>
      <p className="mt-1.5 max-w-[66ch] text-[13px] text-fg-2">
        {addressOnFile ? (
          <>
            On file: <span className="text-fg-1">{addressOnFile}</span>. That is not enough to mail a letter.{" "}
          </>
        ) : (
          "There is no address on file, so this letter can't be mailed. "
        )}
        Reach the owner by email first: their reply link lets them confirm a mailing address, which updates the address on file. Then recompose this letter.
      </p>
      <ol className="mt-3 flex flex-wrap items-center gap-2">
        <li>
          {emailDraftKey ? (
            <ActionButton variant="quiet" onClick={() => onOpenEmail(emailDraftKey)} data-testid="address-fix-email">
              Open the email draft
            </ActionButton>
          ) : (
            <ActionButton variant="quiet" pending={pending} onClick={onDraftEmail} data-testid="address-fix-email">
              Draft an email asking for the address
            </ActionButton>
          )}
        </li>
        <li>
          <Link
            href={`/items?item=${staleItemId}`}
            className="inline-flex min-h-8 items-center gap-1 px-1 text-[13px] text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline"
          >
            See the address and owner state on the item <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden />
          </Link>
        </li>
      </ol>
    </section>
  );
}
