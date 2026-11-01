/**
 * Minimal RFC 5545 iCalendar writer: TEXT escaping (3.3.11), content-line folding at 75 octets (3.1) without
 * splitting a UTF-8 sequence, CRLF line endings, all-day VEVENTs. No dependencies, no time zones (DATE values only).
 */
import { addDays, type IsoDate } from "@/lib/dates";

export const CRLF = "\r\n";
const MAX_OCTETS = 75;

/** Escape a TEXT value: backslash, semicolon, comma and newlines (CRLF, CR or LF become the literal "\n"). */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

const encoder = new TextEncoder();
const octets = (s: string) => encoder.encode(s).length;

/**
 * Fold one content line so no physical line exceeds 75 octets (excluding CRLF). Continuation lines start with a
 * single space, which counts toward their 75. Splits only between code points, never inside a UTF-8 sequence.
 */
export function foldLine(line: string): string {
  if (octets(line) <= MAX_OCTETS) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  let limit = MAX_OCTETS;
  for (const ch of line) {
    const n = octets(ch);
    if (size + n > limit) {
      out.push(current);
      current = " ";
      size = 1;
      limit = MAX_OCTETS;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join(CRLF);
}

/** YYYY-MM-DD -> YYYYMMDD (iCalendar DATE). */
export const icsDate = (date: IsoDate): string => date.replace(/-/g, "");

export interface IcsEvent {
  uid: string;
  /** All-day event on this date (DTEND is the next day, exclusive, per RFC 5545 3.6.1). */
  date: IsoDate;
  summary: string;
  description?: string;
  categories?: string[];
  url?: string;
}

export interface IcsCalendar {
  prodId: string;
  name: string;
  /** DTSTAMP for every event, as an ISO date (written as midnight UTC). Deterministic on purpose. */
  stamp: IsoDate;
  events: readonly IcsEvent[];
}

/** UIDs and URIs are not TEXT; strip anything that would break the line instead of escaping it. */
const safeToken = (s: string) => s.replace(/[\r\n]/g, "");

function eventLines(e: IcsEvent, stamp: IsoDate): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${safeToken(e.uid)}`,
    `DTSTAMP:${icsDate(stamp)}T000000Z`,
    `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
    `DTEND;VALUE=DATE:${icsDate(addDays(e.date, 1))}`,
    `SUMMARY:${escapeText(e.summary)}`,
  ];
  if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
  if (e.categories?.length) lines.push(`CATEGORIES:${e.categories.map(escapeText).join(",")}`);
  if (e.url) lines.push(`URL:${safeToken(e.url)}`);
  lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  return lines;
}

/** Serialize a calendar. Every line (including the last) ends with CRLF. */
export function writeIcs(cal: IcsCalendar): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${safeToken(cal.prodId)}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(cal.name)}`,
    ...cal.events.flatMap((e) => eventLines(e, cal.stamp)),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}
