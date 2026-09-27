/**
 * Date helpers.
 *
 * Throughout the app a calendar date is a plain "YYYY-MM-DD" string. A wedding
 * on "2026-10-03" must mean the same day on every machine, so we never let
 * time zones into the picture: all maths is done in UTC on whole days.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Sunday-first weekday names, matching JavaScript's Date#getDay() numbering. */
export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** True if `value` is a real calendar date in "YYYY-MM-DD" form. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  // Round-tripping catches impossible dates such as "2026-02-31".
  return toIsoDate(parseIsoDate(value)) === value;
}

/** "YYYY-MM-DD" -> Date (at midnight UTC). */
export function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Date -> "YYYY-MM-DD" (using the UTC calendar day). */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Today's date in the server's local time zone.
 *
 * Server-side only. Every other helper here works in UTC, and this one does
 * not — it deliberately uses the local calendar day, because "today" for the
 * photographer running this app means their day, not UTC's. That makes the
 * result depend on where it runs, so calling it while rendering a client
 * component would give one answer during server rendering and possibly
 * another during hydration in the browser. Work "today" out on the server and
 * pass it down as a prop instead.
 */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Add (or subtract, with a negative number) whole days to a date. */
export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** Every date from `start` to `end` inclusive. Empty if end < start. */
export function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }
  return days;
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(iso: string): number {
  return parseIsoDate(iso).getUTCDay();
}

/**
 * The Monday that starts the week containing `iso`. Used as a grouping key so
 * "max shoots per week" counts Monday–Sunday weeks.
 */
export function weekKey(iso: string): string {
  const daysSinceMonday = (weekdayOf(iso) + 6) % 7;
  return addDays(iso, -daysSinceMonday);
}

/** "YYYY-MM" — handy for grouping dates by month. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** The last date of a "YYYY-MM" month, e.g. "2026-02" -> "2026-02-28". */
export function endOfMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  // Day 0 of the *next* month is the last day of this one.
  return toIsoDate(new Date(Date.UTC(year, month, 0)));
}

/** Human-friendly form, e.g. "Sat, Oct 3, 2026". */
export function formatLong(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "October 2026" for a "YYYY-MM" key. */
export function formatMonth(yearMonth: string): string {
  return parseIsoDate(`${yearMonth}-01`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
