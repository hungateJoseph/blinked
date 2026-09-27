/**
 * Database access for bookings and schedules.
 *
 * Route handlers call these functions instead of writing SQL themselves, and
 * everything that leaves this file is a plain "view" object (camelCase, JSON
 * already parsed) that is safe to send straight to the browser.
 */
import { getDb, type BookingRow, type DiscountRow, type ScheduleRow, type UserRow } from "./db";
import { applyDiscounts, type DiscountRule } from "./discounts";
import { parseParts, type DayPart } from "./parts";
import {
  applyHardRules,
  normalizeSlots,
  type BookingInput,
  type ScheduleDraft,
  type SchedulePreferences,
  type ScheduleSlot,
} from "./schedule";
import { newId, nowIso } from "./util";

/** A schedule as the browser sees it. */
export interface ScheduleView {
  id: string;
  status: ScheduleRow["status"];
  rangeStart: string;
  rangeEnd: string;
  preferences: SchedulePreferences;
  slots: ScheduleSlot[];
  summary: string;
  warnings: string[];
  source: ScheduleRow["source"];
  createdAt: string;
  finalizedAt: string | null;
}

function rowToView(row: ScheduleRow): ScheduleView {
  return {
    id: row.id,
    status: row.status,
    rangeStart: row.range_start,
    rangeEnd: row.range_end,
    preferences: JSON.parse(row.preferences_json) as SchedulePreferences,
    slots: JSON.parse(row.slots_json) as ScheduleSlot[],
    summary: row.summary,
    warnings: JSON.parse(row.warnings_json) as string[],
    source: row.source,
    createdAt: row.created_at,
    finalizedAt: row.finalized_at,
  };
}

// --- Bookings ---------------------------------------------------------------

export function listBookings(userId: string): BookingRow[] {
  return getDb()
    .prepare("SELECT * FROM bookings WHERE user_id = ? ORDER BY date")
    .all(userId) as BookingRow[];
}

/** Bookings in the shape the schedule generators want. */
export function listBookingsForScheduling(userId: string): BookingInput[] {
  return listBookings(userId).map((b) => ({
    date: b.date,
    parts: parseParts(JSON.parse(b.parts)),
    label: b.label,
  }));
}

/** A booking as the browser sees it. */
export interface BookingView {
  id: string;
  date: string;
  parts: DayPart[];
  label: string;
}

export function bookingToView(row: BookingRow): BookingView {
  return {
    id: row.id,
    date: row.date,
    parts: parseParts(JSON.parse(row.parts)),
    label: row.label,
  };
}

/**
 * Insert a booking.
 *
 * Two shoots on one day are allowed — a morning ceremony and an evening
 * reception are genuinely separate jobs — but the same part of the same day
 * cannot be booked twice. Returns the clashing parts instead of the new row
 * when that happens, so the caller can say which ones are taken.
 */
export function addBooking(
  userId: string,
  date: string,
  parts: DayPart[],
  label: string,
): { booking: BookingView } | { conflict: DayPart[] } {
  const db = getDb();

  const taken = new Set<DayPart>();
  for (const existing of listBookings(userId).filter((b) => b.date === date)) {
    for (const part of parseParts(JSON.parse(existing.parts))) taken.add(part);
  }
  const conflict = parts.filter((part) => taken.has(part));
  if (conflict.length > 0) return { conflict };

  const row: BookingRow = {
    id: newId(),
    user_id: userId,
    date,
    parts: JSON.stringify(parts),
    label,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO bookings (id, user_id, date, parts, label, created_at)
     VALUES (@id, @user_id, @date, @parts, @label, @created_at)`,
  ).run(row);
  return { booking: bookingToView(row) };
}

/** Delete a booking. Returns false if it did not exist (or belongs to someone else). */
export function deleteBooking(userId: string, bookingId: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM bookings WHERE id = ? AND user_id = ?")
    .run(bookingId, userId);
  return result.changes > 0;
}

// --- Discount rules ---------------------------------------------------------

function discountToRule(row: DiscountRow): DiscountRule {
  return {
    id: row.id,
    label: row.label,
    detail: row.detail,
    weekdays: JSON.parse(row.weekdays) as number[],
    parts: parseParts(JSON.parse(row.parts)),
    dateStart: row.date_start,
    dateEnd: row.date_end,
  };
}

/** The photographer's rules, oldest first — the order they are matched in. */
export function listDiscounts(userId: string): DiscountRule[] {
  const rows = getDb()
    .prepare("SELECT * FROM discounts WHERE user_id = ? ORDER BY created_at")
    .all(userId) as DiscountRow[];
  return rows.map(discountToRule);
}

export function addDiscount(userId: string, rule: Omit<DiscountRule, "id">): DiscountRule {
  const row: DiscountRow = {
    id: newId(),
    user_id: userId,
    label: rule.label,
    detail: rule.detail,
    weekdays: JSON.stringify(rule.weekdays),
    parts: JSON.stringify(rule.parts),
    date_start: rule.dateStart,
    date_end: rule.dateEnd,
    created_at: nowIso(),
  };
  getDb()
    .prepare(
      `INSERT INTO discounts (id, user_id, label, detail, weekdays, parts, date_start, date_end, created_at)
       VALUES (@id, @user_id, @label, @detail, @weekdays, @parts, @date_start, @date_end, @created_at)`,
    )
    .run(row);
  return discountToRule(row);
}

export function deleteDiscount(userId: string, discountId: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM discounts WHERE id = ? AND user_id = ?")
    .run(discountId, userId);
  return result.changes > 0;
}

// --- Schedules --------------------------------------------------------------

/** The newest schedule with the given status, or null. */
export function getLatestSchedule(
  userId: string,
  status: "draft" | "final",
): ScheduleView | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM schedules WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(userId, status) as ScheduleRow | undefined;
  return row ? rowToView(row) : null;
}

/** Store a freshly generated proposal as the user's (only) draft. */
export function saveDraft(
  userId: string,
  draft: ScheduleDraft,
  preferences: SchedulePreferences,
): ScheduleView {
  const db = getDb();
  // Re-read the bookings here rather than trusting the generator's copy: they
  // may have changed while the AI was thinking.
  const slotsWithRules = applyHardRules(
    normalizeSlots(draft.slots, draft.rangeStart, draft.rangeEnd),
    listBookingsForScheduling(userId),
  );
  // Discounts are baked in at save time, so what a couple sees is fixed at the
  // moment of publishing rather than shifting under them if a rule changes.
  const slots = applyDiscounts(slotsWithRules, listDiscounts(userId));
  const row: ScheduleRow = {
    id: newId(),
    user_id: userId,
    status: "draft",
    range_start: draft.rangeStart,
    range_end: draft.rangeEnd,
    preferences_json: JSON.stringify(preferences),
    slots_json: JSON.stringify(slots),
    summary: draft.summary,
    warnings_json: JSON.stringify(draft.warnings),
    source: draft.source,
    created_at: nowIso(),
    finalized_at: null,
  };

  db.transaction(() => {
    db.prepare("DELETE FROM schedules WHERE user_id = ? AND status = 'draft'").run(userId);
    db.prepare(
      `INSERT INTO schedules (id, user_id, status, range_start, range_end, preferences_json,
                              slots_json, summary, warnings_json, source, created_at, finalized_at)
       VALUES (@id, @user_id, @status, @range_start, @range_end, @preferences_json,
               @slots_json, @summary, @warnings_json, @source, @created_at, @finalized_at)`,
    ).run(row);
  })();

  return rowToView(row);
}

/**
 * Turn the draft into the published schedule, using the slots as the
 * photographer edited them during review. Any previous final schedule is
 * archived. Returns null if the draft does not exist.
 */
export function finalizeDraft(
  userId: string,
  scheduleId: string,
  reviewedSlots: ScheduleSlot[],
): ScheduleView | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM schedules WHERE id = ? AND user_id = ? AND status = 'draft'")
    .get(scheduleId, userId) as ScheduleRow | undefined;
  if (!row) return null;

  // The browser sends back the slots as the photographer reviewed them, so the
  // hard rules are re-applied against the bookings as they stand right now.
  const slotsWithRules = applyHardRules(
    normalizeSlots(reviewedSlots, row.range_start, row.range_end),
    listBookingsForScheduling(userId),
  );
  // Discounts are baked in at save time, so what a couple sees is fixed at the
  // moment of publishing rather than shifting under them if a rule changes.
  const slots = applyDiscounts(slotsWithRules, listDiscounts(userId));
  const finalizedAt = nowIso();

  db.transaction(() => {
    db.prepare("UPDATE schedules SET status = 'archived' WHERE user_id = ? AND status = 'final'").run(
      userId,
    );
    db.prepare(
      "UPDATE schedules SET status = 'final', slots_json = ?, finalized_at = ? WHERE id = ?",
    ).run(JSON.stringify(slots), finalizedAt, row.id);
  })();

  return rowToView({ ...row, status: "final", slots_json: JSON.stringify(slots), finalized_at: finalizedAt });
}

/**
 * Take the published schedule down, so the public page shows nothing again.
 *
 * The row is archived rather than deleted: what you once advertised is worth
 * keeping, and archiving is exactly what publishing a newer schedule already
 * does to the previous one. Returns false if nothing was published.
 */
export function unpublishSchedule(userId: string): boolean {
  const result = getDb()
    .prepare("UPDATE schedules SET status = 'archived' WHERE user_id = ? AND status = 'final'")
    .run(userId);
  return result.changes > 0;
}

// --- Public availability ----------------------------------------------------

/** What a potential customer may see: dates and open/closed, never the reasons. */
export interface PublicAvailability {
  photographerName: string;
  rangeStart: string;
  rangeEnd: string;
  finalizedAt: string;
  /** Used by the enquiry form to address the message to the right photographer. */
  slug: string;
  /** One entry per part of each day, in chronological order. */
  slots: {
    date: string;
    part: DayPart;
    available: boolean;
    discount: { label: string; detail: string } | null;
  }[];
}

export function getPublicAvailability(slug: string): PublicAvailability | null {
  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE public_slug = ?").get(slug) as
    | UserRow
    | undefined;
  if (!user) return null;

  const schedule = getLatestSchedule(user.id, "final");
  if (!schedule || !schedule.finalizedAt) return null;

  return {
    // Never the email address: this page needs no sign-in, so only data the
    // photographer chose to make public may appear on it.
    photographerName: user.name || "Your photographer",
    rangeStart: schedule.rangeStart,
    rangeEnd: schedule.rangeEnd,
    finalizedAt: schedule.finalizedAt,
    // Reasons can contain client names ("Booked: Smith wedding"), so strip them.
    slug,
    slots: schedule.slots.map((s) => ({
      date: s.date,
      part: s.part,
      available: s.status === "available",
      // Only ever shown on an open slot; a discount on a date nobody can book
      // would be a broken promise.
      discount: s.status === "available" ? (s.discount ?? null) : null,
    })),
  };
}
