/**
 * External hosts an assistant reply may link to without showing the host: the official sources cited by the
 * rule files (rules/*.json). link-hosts.test.ts fails if a rule file cites a host missing here. Any other
 * http(s) link still renders, but with its hostname shown next to the text, so a link can never hide where it
 * goes (a reply could otherwise smuggle data out in a link's query string behind innocent text).
 */
export const RULE_SOURCE_HOSTS: readonly string[] = [
  "claimittexas.gov",
  "comptroller.texas.gov",
  "delcode.delaware.gov",
  "leginfo.legislature.ca.gov",
  "sco.ca.gov",
  "tcss.legis.texas.gov",
  "unclaimed.org",
  "unclaimedproperty.delaware.gov",
];

const TRUSTED = new Set(RULE_SOURCE_HOSTS);

/** Lower-cased hostname without a leading "www.". */
export function displayHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

export function isTrustedSourceHost(hostname: string): boolean {
  return TRUSTED.has(displayHost(hostname));
}
