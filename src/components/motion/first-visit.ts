import { cookies } from "next/headers";
import { MarkVisited } from "./MarkVisited";
import { hasSeen, SEEN_COOKIE } from "./seen";

/**
 * Server-side: has this page been shown earlier in the browser session? Decided from a session cookie at render time,
 * so a first-load stagger is in the HTML from the start and never flickers on later visits.
 */
export async function isFirstVisit(id: string): Promise<boolean> {
  const jar = await cookies();
  return !hasSeen(jar.get(SEEN_COOKIE)?.value, id);
}

export { MarkVisited };
