import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { DISCLAIMER } from "@/lib/disclaimer";
import { formatUSD } from "@/lib/money";
import { getOutreachDb } from "@/lib/outreach/db";
import { assertOwnerTokenUsable, OwnerTokenConfigError, OwnerTokenError } from "@/lib/outreach/tokens";
import { submitOwnerResponse } from "../actions";
import { loadOwnerView, type OwnerView } from "../view";

export const metadata: Metadata = { title: "Money held for you" };

type Params = Promise<{ token: string }>;
type SearchParams = Promise<{ done?: string | string[]; error?: string | string[] }>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const REASON_COPY: Record<string, { title: string; body: string }> = {
  expired: {
    title: "This link has expired",
    body: "For your security these links stop working after a while. Please contact the company that sent you the notice and they can send a new one.",
  },
  already_used: {
    title: "This link was already used",
    body: "We already received a response through this link, so it can't be used again. If something changed, please contact the company that sent you the notice.",
  },
  invalid: {
    title: "We couldn't open this link",
    body: "The link looks incomplete or incorrect. Please check that you copied the whole address, or contact the company that sent you the notice.",
  },
};

const DONE_COPY: Record<string, { title: string; next: string }> = {
  confirm_address: {
    title: "Thanks, your address is confirmed",
    next: "The company has your updated mailing address. They will contact you using it if anything more is needed.",
  },
  already_cashed: {
    title: "Thanks, we've noted that it was already cashed",
    next: "The company will check its bank records against what you told us and close this item if it matches.",
  },
  send_money: {
    title: "Thanks, your request was sent",
    next: "The company will review your request and reissue the payment to you. This page does not move any money itself.",
  },
};

const ERROR_COPY: Record<string, string> = {
  address: "Please enter your full mailing address: street, city, 2-letter state and a 5-digit ZIP code.",
  invalid: "That didn't look right. Please try again.",
  failed: "Something went wrong on our side and nothing was saved. Please try again in a moment.",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="owner-col">
      <span className="owner-tag">Prototype - synthetic data</span>
      {children}
      <p className="owner-foot">{DISCLAIMER}</p>
    </main>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <h1 className="owner-h1">{title}</h1>
      <p className="owner-lede">{body}</p>
    </Shell>
  );
}

function Details({ v }: { v: OwnerView }) {
  return (
    <section className="owner-card" aria-label="Payment details">
      <div className="owner-amount">{formatUSD(v.amountCents)}</div>
      <dl className="owner-dl">
        <dt>Held by</dt>
        <dd>{v.holderName}</dd>
        <dt>Payable to</dt>
        <dd>{v.payeeName}</dd>
        <dt>Item</dt>
        <dd>
          {v.itemLabel}
          {v.referenceNumber ? ` #${v.referenceNumber}` : ""}
        </dd>
        <dt>Issued</dt>
        <dd>{v.issueDate}</dd>
      </dl>
    </section>
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
      if (e.reason === "already_used" && done && DONE_COPY[done]) {
        return (
          <Shell>
            <div className="owner-alert ok" role="status">
              <strong>{DONE_COPY[done].title}</strong>
            </div>
            <h1 className="owner-h1">What happens next</h1>
            <p className="owner-lede">{DONE_COPY[done].next}</p>
          </Shell>
        );
      }
      const copy = REASON_COPY[e.reason] ?? REASON_COPY.invalid!;
      return <Notice title={copy.title} body={copy.body} />;
    }
    if (e instanceof OwnerTokenConfigError) {
      return <Notice title="This page isn't available right now" body="Please contact the company that sent you the notice." />;
    }
    throw e;
  }

  const view = await loadOwnerView(db, outreachId);
  if (!view) return <Notice {...REASON_COPY.invalid!} />;

  return (
    <Shell>
      <h1 className="owner-h1">{view.holderName} may be holding money for you</h1>
      <p className="owner-lede">
        A payment made out to you was never cashed. Let us know what to do with it using one of the options below. It
        takes about a minute.
      </p>
      <Details v={view} />
      {error && ERROR_COPY[error] ? (
        <div className="owner-alert error" role="alert">
          {ERROR_COPY[error]}
        </div>
      ) : null}
      <form action={submitOwnerResponse} className="owner-card">
        <input type="hidden" name="token" value={token} />
        <h2 className="owner-h2">Confirm your address</h2>
        <p className="owner-help">Fill this in only if you are choosing the first option.</p>
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
          Confirm your address
        </button>
        <p className="owner-or">or</p>
        <button type="submit" name="intent" value="already_cashed" className="owner-btn" formNoValidate>
          I already cashed it
        </button>
        <button type="submit" name="intent" value="send_money" className="owner-btn" formNoValidate>
          Send me the money
        </button>
        <label className="owner-field">
          Anything else you want us to know? (optional)
          <textarea name="note" maxLength={2000} />
        </label>
        <p className="owner-help">
          Choosing a button sends your answer and this note. This link can only be used once.
        </p>
      </form>
    </Shell>
  );
}

export default function Page({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <Suspense fallback={<Shell><p className="owner-lede">Loading...</p></Shell>}>
      <OwnerPage params={params} searchParams={searchParams} />
    </Suspense>
  );
}
