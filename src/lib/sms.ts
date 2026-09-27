/**
 * Texting, through Twilio.
 *
 * Two directions: the photographer texts their assistant (Twilio posts each
 * text to /api/sms/twilio, signed) and the assistant texts them back, or
 * texts them on its own when asked to (send_text). Only the photographer's
 * own, verified number is ever texted — never a couple or a vendor.
 *
 * Without TWILIO_* configured nothing is sent: outgoing texts are printed to
 * the server console, which is what you want locally, and the number-
 * verification code is handed back to the page in development.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** The longest text the assistant sends — about three segments. Longer replies are cut. */
export const SMS_MAX_CHARS = 480;

export function smsEnabled(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID),
  );
}

/** The number the photographer texts, for the settings page; null until configured. */
export function smsFromNumber(): string | null {
  return process.env.TWILIO_FROM_NUMBER || null;
}

export type SmsDelivery = "sms" | "console";

/** Send one text. Throws when Twilio refuses; the caller decides what the photographer is told. */
export async function sendSms(to: string, body: string): Promise<{ delivery: SmsDelivery; sid: string | null }> {
  const text = trimForSms(body);
  if (!smsEnabled()) {
    console.log(`[sms] To ${to}: ${text}`);
    return { delivery: "console", sid: null };
  }
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const params = new URLSearchParams({ To: to, Body: text });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) params.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
  else params.set("From", process.env.TWILIO_FROM_NUMBER!);

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Twilio ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { sid?: string };
  return { delivery: "sms", sid: data.sid ?? null };
}

/** Cut a reply to text length, on a word where possible, with an ellipsis. */
export function trimForSms(text: string): string {
  const clean = text.replace(/\r/g, "").trim();
  if (clean.length <= SMS_MAX_CHARS) return clean;
  const cut = clean.slice(0, SMS_MAX_CHARS - 1);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > SMS_MAX_CHARS - 60 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}

/**
 * "(555) 123-4567", "555.123.4567", "1 555 123 4567", "+44 7700 900123" →
 * E.164, or null when it is not a phone number. Ten digits are read as a US
 * or Canadian number.
 */
export function normalisePhone(input: string, defaultCountry = "1"): string | null {
  const raw = input.trim();
  let e164: string;
  if (raw.startsWith("+")) {
    e164 = `+${raw.slice(1).replace(/\D/g, "")}`;
  } else {
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 10) e164 = `+${defaultCountry}${digits}`;
    else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
    else return null;
  }
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

/** "+15551234567" → "+1 ••• 4567", "+447700900123" → "+44 ••• 0123": enough to recognise, not enough to dial. */
export function maskPhone(e164: string): string {
  if (!/^\+\d{8,15}$/.test(e164)) return e164;
  const country = /^\+1\d{10}$/.test(e164) ? "+1" : e164.slice(0, 3);
  return `${country} ••• ${e164.slice(-4)}`;
}

/**
 * Twilio signs each webhook: HMAC-SHA1 of the exact URL it posted to, followed
 * by every POST field's name and value in key order, keyed with the auth
 * token, base64. Anyone can post to the route; only Twilio can sign it.
 */
export function twilioSignature(url: string, params: Record<string, string>, authToken: string): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  header: string | null,
  authToken: string,
): boolean {
  if (!header) return false;
  const expected = Buffer.from(twilioSignature(url, params, authToken));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The verification code is stored hashed, like a password. */
export function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** For TwiML replies. */
export function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}
