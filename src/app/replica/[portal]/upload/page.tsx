import type { Metadata } from "next";
import { Suspense } from "react";
import { portalHref } from "@/lib/replica/portal";
import { uploadAction } from "../../actions";
import { requireHolderSession } from "../../_lib/auth";
import { resolvePortal } from "../../_lib/page";

export const metadata: Metadata = { title: "Upload report file" };
type Props = { params: Promise<{ portal: string }>; searchParams: Promise<{ error?: string | string[] }> };

async function Upload({ params, searchParams }: Props) {
  const portal = await resolvePortal(params, "holder");
  await requireHolderSession(portal);
  const sp = await searchParams;
  const error = Array.isArray(sp.error) ? sp.error[0] : sp.error;
  return (
    <>
      <h1>Upload report file</h1>
      <p>
        Choose a NAUPA file (.txt) or paste its contents. You will review a summary before anything is submitted.
      </p>
      {error ? <div className="rp-error" role="alert" data-testid="upload-error">{error}</div> : null}
      <form action={uploadAction} data-testid="upload-form">
        <input type="hidden" name="portal" value={portal.slug} />
        <fieldset>
          <legend>Report file</legend>
          <label htmlFor="naupa-file">NAUPA file (.txt)</label>
          <input id="naupa-file" name="naupa-file" type="file" accept=".txt,text/plain" data-testid="naupa-upload" />
          <p className="rp-help">625-character records, CR/LF line endings.</p>
          <label htmlFor="naupa-text">Or paste the file contents</label>
          <textarea id="naupa-text" name="naupa-text" rows={8} spellCheck={false} data-testid="naupa-paste" />
        </fieldset>
        <button type="submit" data-testid="upload-submit">Upload and review</button>
        <a href={portalHref(portal, "dashboard")}>Cancel</a>
      </form>
    </>
  );
}

export default function Page(props: Props) {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <Upload {...props} />
    </Suspense>
  );
}
