import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { getOutreachDb } from "@/lib/outreach/db";
import { assertOwnerTokenUsable, OwnerTokenConfigError, OwnerTokenError } from "@/lib/outreach/tokens";
import { submitOwnerResponse } from "../actions";
import { loadOwnerView } from "../view";
import { NoticeBody, REASON_COPY, Shell } from "../OwnerShell";
import { amountLabel, OwnerConfirmed, OwnerDetails, OwnerRail } from "../OwnerParts";

export const metadata: Metadata = { title: "Money held for you" };

type Params = Promise<{ token: string }>;
type SearchParams = Promise<{ done?: string | string[]; error?: string | string[] }>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const DONE_COPY: Record<string, { title: string; next: string }> = {
  confirm_address: {
    title: "Thanks, your address is confirmed",
    next: "The company has your updated mailing address. They will contact you using it if anything more is needed.",
  },
  already_cashed: {
    title: "Thanks, we've noted that it was already cashed",
    next: "The company will verify this against its bank records. Nothing is closed until they confirm it.",
  },
  send_money: {
    title: "Thanks, your request was sent",
    next: "The company will verify your identity and the payment details before anything is reissued. This page does not move any money, and your request does not close the item by itself.",
  },
};

const ERROR_COPY: Record<string, string> = {
  address: "Please enter your full mailing address: street, city, 2-letter state and a 5-digit ZIP code.",
  invalid: "That didn't look right. Please try again.",
  failed: "Something went wrong on our side and nothing was saved. Please try again in a moment.",
};

/** The three answers (§6.17), each a large button posting to the existing server action. */
function ResponseChoices({ token }: { token: string }) {
  return (
    <form action={submitOwnerResponse} className="owner-card" aria-labelledby="owner-choose">
      <input type="hidden" name="token" value={token} />
      <h2 id="owner-choose" className="owner-h2">
        What should we do with it?
      </h2>
      <p className="owner-help">Pick one. It takes about a minute, and this link works once.</p>

      <fieldset className="owner-choice">
        <legend className="owner-choice-title">Confirm my address</legend>
        <p className="owner-help">We will mail it to you. Fill this in only for this option.</p>
        <div className="owner-grid">
          <label className="owner-field span-all">
            Street address
            <input name="line1" autoComplete="address-line1" maxLength={200} />
          </label>
          <label className="owner-field">
            City
            <input name="city" autoComplete="address-level2" maxLength={100} />
          </label>
          <label className="owner-field">
            State
            <input name="state" autoComplete="address-level1" maxLength={2} placeholder="CA" />
          </label>
          <label className="owner-field">
            ZIP
            <input name="zip" autoComplete="postal-code" inputMode="numeric" maxLength={10} />
          </label>
        </div>
        <button type="submit" name="intent" value="confirm_address" className="owner-btn primary">
          Confirm my address
        </button>
      </fieldset>

      <div className="owner-or" aria-hidden>
        or
      </div>
      <button type="submit" name="intent" value="already_cashed" className="owner-btn" formNoValidate>
        I already cashed it
      </button>
      <button type="submit" name="intent" value="send_money" className="owner-btn" formNoValidate>
        Send me the money
      </button>

      <label className="owner-field owner-note">
        Anything else you want us to know? (optional)
        <textarea name="note" maxLength={2000} />
      </label>
      <p className="owner-help">Choosing a button sends your answer and this note.</p>
    </form>
  );
}

async function OwnerPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await connection(); // token expiry compares against the real clock
  const { token } = await params;
  const sp = await searchParams;
  const done = first(sp.done);
  const error = first(sp.error);
  const db = await getOutreachDb();

  let outreachId: string;
  try {
    ({ outreachId } = await assertOwnerTokenUsable(db, token));
  } catch (e) {
    if (e instanceof OwnerTokenError) {
      if (e.reason === "already_used" && done && DONE_COPY[done]) return <OwnerConfirmed {...DONE_COPY[done]} />;
      const copy = REASON_COPY[e.reason] ?? REASON_COPY.invalid!;
      return <NoticeBody title={copy.title} body={copy.body} />;
    }
    if (e instanceof OwnerTokenConfigError) {
      return <NoticeBody title="This page isn't available right now" body="Please contact the company that sent you the notice." />;
    }
    throw e;
  }

  const view = await loadOwnerView(db, outreachId);
  if (!view) return <NoticeBody {...REASON_COPY.invalid!} />;

  return (
    <>
      <section className="owner-card owner-hero" aria-labelledby="owner-title">
        <p className="owner-eyebrow">{view.holderName}</p>
        <h1 id="owner-title" className="owner-h1">
          We are holding <span className="owner-amount">{amountLabel(view.amountCents)}</span> for you
        </h1>
        <p className="owner-lede">A payment made out to you was never cashed. Tell us what to do with it below.</p>
        <OwnerDetails v={view} />
      </section>
      <OwnerRail v={view} />
      {error && ERROR_COPY[error] ? (
        <div className="owner-alert error" role="alert">
          {ERROR_COPY[error]}
        </div>
      ) : null}
      <ResponseChoices token={token} />
    </>
  );
}

export default function Page({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  // The Shell (with the one disclaimer) is outside the boundary, so a streamed fallback never duplicates it.
  return (
    <Shell>
      <Suspense fallback={<p className="owner-lede">Loading…</p>}>
        <OwnerPage params={params} searchParams={searchParams} />
      </Suspense>
    </Shell>
  );
}
