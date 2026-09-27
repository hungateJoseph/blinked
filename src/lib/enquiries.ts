/**
 * Enquiries left by potential clients on a public availability page.
 *
 * These arrive from anonymous visitors, so everything here assumes the input
 * is hostile: fields are length-capped, at least one way of replying is
 * required, and the caller rate limits before getting this far.
 */
import { getDb, type EnquiryRow } from "./db";
import { isDayPart, type DayPart } from "./parts";
import { isIsoDate } from "./dates";
import { newId, nowIso } from "./util";

export const MAX_NAME = 80;
export const MAX_CONTACT = 120;
export const MAX_MESSAGE = 2000;

/** An enquiry as the photographer sees it. */
export interface EnquiryView {
  id: string;
  date: string | null;
  part: DayPart | null;
  name: string;
  email: string;
  phone: string;
  message: string;
  createdAt: string;
  read: boolean;
  archived: boolean;
}

function toView(row: EnquiryRow): EnquiryView {
  return {
    id: row.id,
    date: row.date,
    part: isDayPart(row.part) ? row.part : null,
    name: row.name,
    email: row.email,
    phone: row.phone,
    message: row.message,
    createdAt: row.created_at,
    read: row.read_at !== null,
    archived: row.archived_at !== null,
  };
}

export interface NewEnquiry {
  date: string | null;
  part: DayPart | null;
  name: string;
  email: string;
  phone: string;
  message: string;
}

/**
 * Validate an enquiry submitted by an anonymous visitor.
 *
 * Returns either the cleaned enquiry or a message to show the sender. The
 * messages are deliberately plain: whoever is filling this in is a couple
 * trying to book a wedding, not a developer.
 */
export function parseEnquiry(input: unknown): { enquiry: NewEnquiry } | { error: string } {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;

  const str = (value: unknown, max: number) =>
    typeof value === "string" ? value.trim().slice(0, max) : "";

  const name = str(raw.name, MAX_NAME);
  const email = str(raw.email, MAX_CONTACT);
  const phone = str(raw.phone, MAX_CONTACT);
  const message = str(raw.message, MAX_MESSAGE);

  if (!name) return { error: "Please tell the photographer your name." };
  if (!message) return { error: "Please write a message." };
  if (!email && !phone) {
    return { error: "Please leave an email address or a phone number so they can reply." };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "That email address does not look right." };
  }
  if (phone && !/^[\d\s()+.-]{6,}$/.test(phone)) {
    return { error: "That phone number does not look right." };
  }

  return {
    enquiry: {
      // A date and part are optional: someone may just want to say hello.
      date: isIsoDate(raw.date) ? raw.date : null,
      part: isDayPart(raw.part) ? raw.part : null,
      name,
      email,
      phone,
      message,
    },
  };
}

export function addEnquiry(userId: string, enquiry: NewEnquiry): EnquiryView {
  const row: EnquiryRow = {
    id: newId(),
    user_id: userId,
    date: enquiry.date,
    part: enquiry.part,
    name: enquiry.name,
    email: enquiry.email,
    phone: enquiry.phone,
    message: enquiry.message,
    created_at: nowIso(),
    read_at: null,
    archived_at: null,
  };
  getDb()
    .prepare(
      `INSERT INTO enquiries (id, user_id, date, part, name, email, phone, message, created_at, read_at, archived_at)
       VALUES (@id, @user_id, @date, @part, @name, @email, @phone, @message, @created_at, @read_at, @archived_at)`,
    )
    .run(row);
  return toView(row);
}

export function listEnquiries(userId: string, includeArchived = false): EnquiryView[] {
  const sql = includeArchived
    ? "SELECT * FROM enquiries WHERE user_id = ? ORDER BY created_at DESC"
    : "SELECT * FROM enquiries WHERE user_id = ? AND archived_at IS NULL ORDER BY created_at DESC";
  const rows = getDb().prepare(sql).all(userId) as EnquiryRow[];
  return rows.map(toView);
}

/** How many unread, for the badge in the navigation. */
export function countUnread(userId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS c FROM enquiries WHERE user_id = ? AND read_at IS NULL AND archived_at IS NULL")
    .get(userId) as { c: number };
  return row.c;
}

/** Mark read/unread or archived/not. Returns the updated enquiry, or null. */
export function updateEnquiry(
  userId: string,
  enquiryId: string,
  changes: { read?: boolean; archived?: boolean },
): EnquiryView | null {
  const db = getDb();
  const sets: string[] = [];
  const values: (string | null)[] = [];

  if (changes.read !== undefined) {
    sets.push("read_at = ?");
    values.push(changes.read ? nowIso() : null);
  }
  if (changes.archived !== undefined) {
    sets.push("archived_at = ?");
    values.push(changes.archived ? nowIso() : null);
  }
  if (sets.length === 0) return null;

  db.prepare(`UPDATE enquiries SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(
    ...values,
    enquiryId,
    userId,
  );

  const row = db
    .prepare("SELECT * FROM enquiries WHERE id = ? AND user_id = ?")
    .get(enquiryId, userId) as EnquiryRow | undefined;
  return row ? toView(row) : null;
}

/** Delete an enquiry outright — the couple's details go with it. */
export function deleteEnquiry(userId: string, enquiryId: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM enquiries WHERE id = ? AND user_id = ?")
    .run(enquiryId, userId);
  return result.changes > 0;
}
