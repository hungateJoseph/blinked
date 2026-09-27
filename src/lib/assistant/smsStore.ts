/**
 * The photographer's verified mobile, and the bookkeeping around texting.
 *
 * Verifying a number: a six-digit code is texted to it, stored hashed with
 * an expiry; the photographer types it back. Five wrong tries or ten minutes
 * and the code is dead; three codes an hour is the most one account can ask
 * for. A verified number belongs to one account (a partial unique index), so
 * an incoming text maps to exactly one photographer.
 */
import { randomInt } from "node:crypto";
import { getDb, type SmsNumberRow } from "../db";
import { hashCode } from "../sms";

export const CODE_LIFETIME_MINUTES = 10;
export const MAX_CODE_ATTEMPTS = 5;
export const CODE_SENDS_PER_HOUR = 3;

const nowIso = () => new Date().toISOString();

export function getSmsNumber(userId: string): SmsNumberRow | null {
  return (getDb().prepare("SELECT * FROM sms_numbers WHERE user_id = ?").get(userId) as SmsNumberRow | undefined) ?? null;
}

export interface SmsStatus {
  /** E.164, or null when none has been entered. */
  number: string | null;
  verified: boolean;
  /** A code has gone out and not come back yet. */
  pending: boolean;
}

export function smsStatus(userId: string): SmsStatus {
  const row = getSmsNumber(userId);
  if (!row) return { number: null, verified: false, pending: false };
  const pending = !row.verified_at && !!row.code_hash && !!row.code_expires_at && row.code_expires_at > nowIso();
  return { number: row.number, verified: !!row.verified_at, pending };
}

/** True when a text from this number should reach this account. */
export function canText(userId: string): boolean {
  return smsStatus(userId).verified;
}

export type StartResult = { ok: true; code: string } | { ok: false; error: string; status: number };

/** Begin verifying `number` (E.164) for `userId`: returns the code to send. */
export function startVerification(userId: string, number: string): StartResult {
  const db = getDb();
  const owner = db.prepare("SELECT user_id FROM sms_numbers WHERE number = ? AND verified_at IS NOT NULL").get(number) as
    | { user_id: string }
    | undefined;
  if (owner && owner.user_id !== userId) {
    return { ok: false, error: "That number is already linked to another account.", status: 409 };
  }

  const existing = getSmsNumber(userId);
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const sends = (existing ? (JSON.parse(existing.sends_json) as string[]) : []).filter((t) => t > hourAgo);
  if (sends.length >= CODE_SENDS_PER_HOUR) {
    return { ok: false, error: `Only ${CODE_SENDS_PER_HOUR} codes an hour. Try again a little later.`, status: 429 };
  }

  const code = String(randomInt(100000, 1000000));
  const now = nowIso();
  const expires = new Date(Date.now() + CODE_LIFETIME_MINUTES * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO sms_numbers (user_id, number, verified_at, code_hash, code_expires_at, attempts, sends_json, updated_at)
     VALUES (@user_id, @number, NULL, @code_hash, @code_expires_at, 0, @sends_json, @updated_at)
     ON CONFLICT(user_id) DO UPDATE SET
       number = excluded.number, verified_at = NULL, code_hash = excluded.code_hash,
       code_expires_at = excluded.code_expires_at, attempts = 0, sends_json = excluded.sends_json,
       updated_at = excluded.updated_at`,
  ).run({
    user_id: userId,
    number,
    code_hash: hashCode(code),
    code_expires_at: expires,
    sends_json: JSON.stringify([...sends, now]),
    updated_at: now,
  });
  return { ok: true, code };
}

export type ConfirmResult = { ok: true; number: string } | { ok: false; error: string };

/** Check the code the photographer typed. */
export function confirmVerification(userId: string, code: string): ConfirmResult {
  const db = getDb();
  const row = getSmsNumber(userId);
  if (!row || !row.code_hash || !row.code_expires_at) return { ok: false, error: "Send a code first." };
  if (row.verified_at) return { ok: true, number: row.number };
  if (row.code_expires_at <= nowIso()) return { ok: false, error: "That code has expired. Send a new one." };
  if (row.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, error: "Too many tries. Send a new code." };
  if (hashCode(code.trim()) !== row.code_hash) {
    db.prepare("UPDATE sms_numbers SET attempts = attempts + 1, updated_at = ? WHERE user_id = ?").run(nowIso(), userId);
    return { ok: false, error: "That code is not right." };
  }
  try {
    db.prepare(
      `UPDATE sms_numbers SET verified_at = ?, code_hash = NULL, code_expires_at = NULL, attempts = 0, updated_at = ?
       WHERE user_id = ?`,
    ).run(nowIso(), nowIso(), userId);
  } catch {
    // The partial unique index: someone verified this number in between.
    return { ok: false, error: "That number is already linked to another account." };
  }
  return { ok: true, number: row.number };
}

export function removeNumber(userId: string): void {
  getDb().prepare("DELETE FROM sms_numbers WHERE user_id = ?").run(userId);
}

/** The account a verified number belongs to, for routing an incoming text. */
export function userIdForNumber(number: string): string | null {
  const row = getDb().prepare("SELECT user_id FROM sms_numbers WHERE number = ? AND verified_at IS NOT NULL").get(number) as
    | { user_id: string }
    | undefined;
  return row?.user_id ?? null;
}

/** Note an incoming text by its provider id; false when it was seen before (a redelivery). */
export function recordInbound(sid: string, userId: string): boolean {
  const result = getDb()
    .prepare("INSERT OR IGNORE INTO sms_inbound (sid, user_id, created_at) VALUES (?, ?, ?)")
    .run(sid, userId, nowIso());
  return result.changes === 1;
}

/** Texts sent to the photographer since midnight UTC — replies and send_text alike — for the daily cap. */
export function countTextsToday(userId: string): number {
  const startOfDay = `${nowIso().slice(0, 10)}T00:00:00.000Z`;
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM assistant_messages
       WHERE user_id = ? AND channel = 'sms' AND role = 'assistant' AND created_at >= ?`,
    )
    .get(userId, startOfDay) as { c: number };
  return row.c;
}
