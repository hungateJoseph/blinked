/**
 * Parts of the day.
 *
 * A wedding photographer's day splits naturally into three blocks, which is
 * also how couples ask about availability ("are you free that evening?").
 * Every booking occupies one or more parts, and availability is tracked per
 * part rather than per whole day.
 *
 * The order of DAY_PARTS is the order they happen in, and the rest of the app
 * relies on that when sorting and displaying.
 */

export const DAY_PARTS = ["morning", "afternoon", "evening"] as const;

export type DayPart = (typeof DAY_PARTS)[number];

/** Full names, for labels and prose. */
export const PART_LABELS: Record<DayPart, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

/** Single letters, for the tight calendar cells. */
export const PART_INITIALS: Record<DayPart, string> = {
  morning: "M",
  afternoon: "A",
  evening: "E",
};

/**
 * Rough clock times. Deliberately approximate — these are a hint for the
 * photographer and the couple, not a contract. Ceremony times get agreed
 * between people, not picked from a dropdown.
 */
export const PART_HINTS: Record<DayPart, string> = {
  morning: "until about midday",
  afternoon: "about midday to 5pm",
  evening: "from about 5pm",
};

export function isDayPart(value: unknown): value is DayPart {
  return typeof value === "string" && (DAY_PARTS as readonly string[]).includes(value);
}

/**
 * Clean up a list of parts from the browser or the AI: keep only real parts,
 * remove duplicates, and put them in chronological order. An empty or
 * unrecognisable input means the whole day, which is the common case for a
 * wedding and the safer assumption when something is ambiguous.
 */
export function parseParts(value: unknown): DayPart[] {
  if (!Array.isArray(value)) return [...DAY_PARTS];
  const kept = DAY_PARTS.filter((part) => value.includes(part));
  return kept.length > 0 ? kept : [...DAY_PARTS];
}

/** "Morning and evening", "All day", "Afternoon" — for one-line summaries. */
export function describeParts(parts: DayPart[]): string {
  if (parts.length === DAY_PARTS.length) return "All day";
  const names = parts.map((p) => PART_LABELS[p]);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
