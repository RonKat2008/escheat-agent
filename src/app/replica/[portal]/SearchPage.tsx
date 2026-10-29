import { loadSearchRecords, portalHref, searchQuerySchema, searchRecords, type Portal, type SearchRecord } from "@/lib/replica/portal";
import { Money } from "../_lib/page";

type Sp = { name?: string | string[]; city?: string | string[] };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function runSearch(portal: Portal, name: string, city: string): { results?: SearchRecord[]; error?: string } {
  const parsed = searchQuerySchema.safeParse({ name, city: city || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid search." };
  return { results: searchRecords(portal.state, parsed.data, loadSearchRecords()) };
}

export function SearchPage({ portal, searchParams }: { portal: Portal; searchParams: Sp }) {
  const name = first(searchParams.name);
  const city = first(searchParams.city);
  const searched = name.trim() !== "" || city.trim() !== "";
  const { results, error } = searched ? runSearch(portal, name, city) : {};
  return (
    <>
      <h1>Search unclaimed property - {portal.stateName}</h1>
      <p>Enter the name of a person or business to search the replica unclaimed property records.</p>
      <form method="get" action={portalHref(portal)}>
        <fieldset>
          <legend>Search unclaimed property</legend>
          <label htmlFor="search-name">Owner name <span className="rp-req" aria-hidden="true">*</span></label>
          <input id="search-name" name="name" type="text" defaultValue={name} required minLength={2} data-testid="search-name" />
          <label htmlFor="search-city">City (optional)</label>
          <input id="search-city" name="city" type="text" defaultValue={city} data-testid="search-city" />
          <p style={{ marginTop: 12 }}>
            <button type="submit" data-testid="search-submit">Search</button>
          </p>
        </fieldset>
      </form>
      {error ? (
        <div className="rp-error" role="alert" data-testid="search-error">{error}</div>
      ) : null}
      {results ? (
        <section aria-labelledby="results-h" data-testid="search-results">
          <h2 id="results-h">Search results ({results.length})</h2>
          {results.length === 0 ? (
            <p data-testid="no-results">No records matched your search.</p>
          ) : (
            <div className="rp-scroll">
              <table>
                <caption className="rp-visually-hidden">Matching unclaimed property records</caption>
                <thead>
                  <tr>
                    <th scope="col">Owner name</th>
                    <th scope="col">City</th>
                    <th scope="col">Reported by</th>
                    <th scope="col">Property type</th>
                    <th scope="col" className="rp-num">Amount</th>
                    <th scope="col">Property ID</th>
                    <th scope="col"><span className="rp-visually-hidden">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.propertyId} data-testid="result-row">
                      <td>{r.ownerName}</td>
                      <td>{r.city}</td>
                      <td>{r.reportedBy}</td>
                      <td>{r.propertyType}</td>
                      <td className="rp-num" data-testid="result-amount"><Money cents={r.amountCents} /></td>
                      <td>{r.propertyId}</td>
                      <td>
                        <a
                          className="rp-button"
                          href={portalHref(portal, "claim", encodeURIComponent(r.propertyId))}
                          data-testid="claim-button"
                          aria-label={`Claim this property: ${r.propertyId}, ${r.ownerName}`}
                        >
                          Claim this property
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
