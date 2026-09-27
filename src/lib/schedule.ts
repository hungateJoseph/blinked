/**
 * Availability schedules: shared types plus the rule-based generator.
 *
 * Availability is tracked per part of day, so one date carries three slots
 * (morning, afternoon, evening). A photographer can shoot a morning ceremony
 * and still offer the evening to someone else.
 *
 * The AI generator (lib/ai.ts) produces the same `ScheduleDraft` shape, so the
 * UI does not care which one made a draft. The rule-based version runs when no
 * ANTHROPIC_API_KEY is configured — and is also a predictable reference for
 * what a "sensible" schedule looks like.
 */
import { addDays, eachDay, weekKey, weekdayOf } from "./dates";
import { DAY_PARTS, type DayPart } from "./parts";

/** What the photographer tells us about how they like to work. */
export interface SchedulePreferences {
  /** Days of the week they take bookings on (0 = Sunday ... 6 = Saturday). */
  workingDays: number[];
  /** Parts of the day they are willing to shoot. */
  workingParts: DayPart[];
  /** Upper limit of weddings (booked + offered) in any Monday–Sunday week. */
  maxShootsPerWeek: number;
  /** Days off after each booked wedding (editing, travel, rest). */
  restDaysAfterShoot: number;
  /** Free-text notes, e.g. "On holiday 10–20 August". Only the AI can apply these. */
  notes: string;
}

/** One part of one day in a proposed schedule. */
export interface ScheduleSlot {
  date: string; // YYYY-MM-DD
  part: DayPart;
  status: "available" | "blocked";
  reason: string; // short explanation shown to the photographer
  /**
   * A discount offered on this slot, from the photographer's standing rules.
   * Null on blocked slots and when no rule matches. Set when the schedule is
   * saved, so what a couple sees is fixed at the moment of publishing.
   */
  discount?: { label: string; detail: string } | null;
}

/** A schedule proposal, before or after review. */
export interface ScheduleDraft {
  rangeStart: string;
  rangeEnd: string;
  slots: ScheduleSlot[];
  summary: string;
  warnings: string[];
  source: "ai" | "rules";
}

/** Existing bookings as the generators need them. */
export interface BookingInput {
  date: string;
  parts: DayPart[];
  label: string;
}

export const DEFAULT_PREFERENCES: SchedulePreferences = {
  workingDays: [5, 6, 0], // Friday, Saturday, Sunday
  workingParts: [...DAY_PARTS],
  maxShootsPerWeek: 2,
  restDaysAfterShoot: 1,
  notes: "",
};

/**
 * Clean up preferences that arrived from the browser. Anything missing or out
 * of range falls back to a sensible default rather than failing the request.
 */
export function normalizePreferences(input: unknown): SchedulePreferences {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Partial<
    Record<keyof SchedulePreferences, unknown>
  >;

  const workingDays = Array.isArray(raw.workingDays)
    ? raw.workingDays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6)
    : DEFAULT_PREFERENCES.workingDays;

  const workingParts = Array.isArray(raw.workingParts)
    ? DAY_PARTS.filter((p) => (raw.workingParts as unknown[]).includes(p))
    : DEFAULT_PREFERENCES.workingParts;

  const clampInt = (value: unknown, min: number, max: number, fallback: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.round(value)))
      : fallback;

  return {
    workingDays: workingDays.length
      ? [...new Set(workingDays)].sort()
      : DEFAULT_PREFERENCES.workingDays,
    // An empty list would mean "never available", which is never what someone
    // means — treat it as no restriction.
    workingParts: workingParts.length ? workingParts : DEFAULT_PREFERENCES.workingParts,
    maxShootsPerWeek: clampInt(raw.maxShootsPerWeek, 1, 7, DEFAULT_PREFERENCES.maxShootsPerWeek),
    restDaysAfterShoot: clampInt(
      raw.restDaysAfterShoot,
      0,
      7,
      DEFAULT_PREFERENCES.restDaysAfterShoot,
    ),
    notes: typeof raw.notes === "string" ? raw.notes.trim().slice(0, 2000) : "",
  };
}

/** Index bookings as "date|part" -> label, for quick lookups. */
function bookedIndex(bookings: BookingInput[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const booking of bookings) {
    for (const part of booking.parts) {
      index.set(`${booking.date}|${part}`, booking.label);
    }
  }
  return index;
}

/**
 * Generate a schedule with plain rules — no AI involved.
 *
 * For every part of every day in the range, in order:
 *   1. Already booked?                          -> blocked
 *   2. Within the rest period after a booking?  -> blocked
 *   3. Not one of the working days or parts?    -> blocked
 *   4. Week already at the max number of shoots -> blocked
 *   5. Otherwise                                -> available
 */
export function generateScheduleByRules(
  bookings: BookingInput[],
  prefs: SchedulePreferences,
  rangeStart: string,
  rangeEnd: string,
): ScheduleDraft {
  const booked = bookedIndex(bookings);

  // Every date that falls inside a rest window after a booking.
  const restDates = new Set<string>();
  for (const booking of bookings) {
    for (let i = 1; i <= prefs.restDaysAfterShoot; i++) {
      restDates.add(addDays(booking.date, i));
    }
  }

  // Bookings count toward the weekly limit even if they fall outside the
  // range. One booking is one shoot, however many parts of the day it covers.
  const shootsPerWeek = new Map<string, number>();
  for (const booking of bookings) {
    const key = weekKey(booking.date);
    shootsPerWeek.set(key, (shootsPerWeek.get(key) ?? 0) + 1);
  }

  const slots: ScheduleSlot[] = [];
  let availableCount = 0;

  for (const date of eachDay(rangeStart, rangeEnd)) {
    // A day only counts once against the weekly limit, no matter how many of
    // its parts end up offered.
    let countedThisDay = false;

    for (const part of DAY_PARTS) {
      const label = booked.get(`${date}|${part}`);
      if (label !== undefined) {
        slots.push({
          date,
          part,
          status: "blocked",
          reason: label ? `Booked: ${label}` : "Already booked",
        });
        continue;
      }
      if (restDates.has(date)) {
        slots.push({ date, part, status: "blocked", reason: "Rest day after a wedding" });
        continue;
      }
      if (!prefs.workingDays.includes(weekdayOf(date))) {
        slots.push({ date, part, status: "blocked", reason: "Not a working day" });
        continue;
      }
      if (!prefs.workingParts.includes(part)) {
        slots.push({ date, part, status: "blocked", reason: "Not a working time" });
        continue;
      }
      const week = weekKey(date);
      if (!countedThisDay && (shootsPerWeek.get(week) ?? 0) >= prefs.maxShootsPerWeek) {
        slots.push({ date, part, status: "blocked", reason: "Weekly limit reached" });
        continue;
      }
      if (!countedThisDay) {
        shootsPerWeek.set(week, (shootsPerWeek.get(week) ?? 0) + 1);
        countedThisDay = true;
      }
      availableCount++;
      slots.push({ date, part, status: "available", reason: "Open for bookings" });
    }
  }

  const warnings: string[] = [];
  if (prefs.notes) {
    warnings.push(
      "Your notes were not applied: the rule-based scheduler cannot read free text. Add an ANTHROPIC_API_KEY to enable AI scheduling.",
    );
  }

  const openDays = new Set(
    slots.filter((s) => s.status === "available").map((s) => s.date),
  ).size;

  return {
    rangeStart,
    rangeEnd,
    slots,
    summary: `${availableCount} open slot${availableCount === 1 ? "" : "s"} across ${openDays} day${openDays === 1 ? "" : "s"} between ${rangeStart} and ${rangeEnd}, based on your working days and times, weekly limit and rest days.`,
    warnings,
    source: "rules",
  };
}

/**
 * Force the non-negotiable rule onto a set of slots, whoever produced them: a
 * part of a day you already have a wedding in is never offered to anyone else.
 *
 * The rule-based generator honours this by construction and the AI is told to,
 * but neither is the safeguard. This is — it runs on every schedule before it
 * is stored, so a booking added after a draft was generated, a model that
 * ignored an instruction, or a hand-crafted request to the API all end up with
 * the same, correct answer.
 */
export function applyHardRules(
  slots: ScheduleSlot[],
  bookings: BookingInput[],
): ScheduleSlot[] {
  const booked = bookedIndex(bookings);
  return slots.map((slot) => {
    const label = booked.get(`${slot.date}|${slot.part}`);
    if (label === undefined) return slot;
    return {
      date: slot.date,
      part: slot.part,
      status: "blocked",
      reason: label ? `Booked: ${label}` : "Already booked",
    };
  });
}

/**
 * Make sure a list of slots (from the AI or from the browser) covers every
 * part of every date in the range exactly once. Missing ones become blocked;
 * extras and duplicates are dropped.
 */
export function normalizeSlots(
  slots: ScheduleSlot[],
  rangeStart: string,
  rangeEnd: string,
): ScheduleSlot[] {
  const byKey = new Map<string, ScheduleSlot>();
  for (const slot of slots) {
    const key = `${slot.date}|${slot.part}`;
    if (!byKey.has(key)) byKey.set(key, slot);
  }

  const complete: ScheduleSlot[] = [];
  for (const date of eachDay(rangeStart, rangeEnd)) {
    for (const part of DAY_PARTS) {
      complete.push(
        byKey.get(`${date}|${part}`) ?? {
          date,
          part,
          status: "blocked",
          reason: "Not covered by the proposal",
        },
      );
    }
  }
  return complete;
}
