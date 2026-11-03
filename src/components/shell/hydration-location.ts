/**
 * Pure part of useShellLocation (no React, unit tested in node).
 *
 * Why it exists: the shell's nav, breadcrumb and Loop Bar sit in streamed Suspense boundaries (the sidebar and header
 * read the database). A client navigation can start while such a boundary is still dehydrated, e.g. a click on a page
 * link that React hydrates first (selective hydration) on a slow runner. When that boundary hydrates afterwards it
 * must render exactly what the server sent for the document's URL; rendering the new route instead ("Reports" marked
 * aria-current in the HTML, "Chat" on the client) is a hydration mismatch and React throws the tree away.
 */
export interface ShellLocation {
  pathname: string;
  search: string;
}

/** The location to render: the document's server-rendered location while hydrating, the live one afterwards. */
export function pickShellLocation(hydrating: boolean, documentLocation: ShellLocation | null, live: ShellLocation): ShellLocation {
  return hydrating && documentLocation ? documentLocation : live;
}
