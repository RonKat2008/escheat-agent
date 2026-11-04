import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { REPLICA_PASSWORD, REPLICA_USERNAME, portalHref, safeReturnTo } from "@/lib/replica/portal";
import { loginAction } from "../actions";
import { getHolderSession } from "../_lib/auth";
import { resolvePortal } from "../_lib/page";
import { SearchPage } from "./SearchPage";

export const metadata: Metadata = { title: "Sign in / Search" };

type Params = Promise<{ portal: string }>;
type SearchParams = Promise<{ error?: string | string[]; next?: string | string[]; name?: string | string[]; city?: string | string[] }>;

async function Entry({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const portal = await resolvePortal(params);
  const sp = await searchParams;
  if (portal.kind === "search") return <SearchPage portal={portal} searchParams={sp} />;
  const next = safeReturnTo(portal.slug, Array.isArray(sp.next) ? sp.next[0] : sp.next);
  if (await getHolderSession(portal)) redirect(next ?? portalHref(portal, "dashboard"));
  const error = Array.isArray(sp.error) ? sp.error[0] : sp.error;
  return (
    <>
      <h1>Holder login - {portal.stateName} unclaimed property reports</h1>
      {/* Palette exception: the light-yellow credentials box is deliberate. It mimics a mock government site, so it stays off the app palette. */}
      <div className="rp-box" data-testid="demo-credentials">
        <strong>Demo credentials</strong>
        <p style={{ margin: "4px 0 0" }}>
          User name: <code>{REPLICA_USERNAME}</code>
          <br />
          Password: <code>{REPLICA_PASSWORD}</code>
        </p>
        <p className="rp-help">These are fake and work only in this replica.</p>
      </div>
      {error ? (
        <div className="rp-error" role="alert" data-testid="login-error">{error}</div>
      ) : null}
      <form action={loginAction}>
        <input type="hidden" name="portal" value={portal.slug} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <fieldset>
          <legend>Sign in</legend>
          <label htmlFor="username">User name <span className="rp-req" aria-hidden="true">*</span></label>
          <input id="username" name="username" type="text" autoComplete="username" required data-testid="login-username" />
          <label htmlFor="password">Password <span className="rp-req" aria-hidden="true">*</span></label>
          <input id="password" name="password" type="password" autoComplete="current-password" required data-testid="login-password" />
          <p style={{ marginTop: 12 }}>
            <button type="submit" data-testid="login-submit">Sign in</button>
          </p>
        </fieldset>
      </form>
    </>
  );
}

export default function Page({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <Entry params={params} searchParams={searchParams} />
    </Suspense>
  );
}
