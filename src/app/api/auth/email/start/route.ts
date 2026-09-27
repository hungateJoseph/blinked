/**
 * POST /api/auth/email/start  { email }
 *
 * Step one of email sign-in: create a 6-digit one-time code and deliver it.
 *
 * Beta note: there is no email provider yet (see lib/mailer.ts), so the code
 * goes to the server console. When that is the case we hand the code back to
 * the login page so you can sign in during development — except in production,
 * where returning it would let anyone sign in as anyone. A production server
 * with no mailer therefore refuses the request outright rather than claiming
 * to have sent an email that nobody will receive.
 */
import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api";
import { getDb } from "@/lib/db";
import { sendLoginCode } from "@/lib/mailer";
import { looksLikeEmail, newId } from "@/lib/util";

const CODE_LIFETIME_MINUTES = 10;

export async function POST(request: Request) {
  const body = await readJson(request);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!looksLikeEmail(email)) {
    return jsonError("Please enter a valid email address.");
  }

  const code = String(randomInt(100000, 1000000)); // always 6 digits
  const expiresAt = new Date(Date.now() + CODE_LIFETIME_MINUTES * 60 * 1000).toISOString();

  const db = getDb();
  // Only the newest code for an address should work.
  db.prepare("UPDATE login_codes SET used = 1 WHERE email = ? AND used = 0").run(email);
  db.prepare(
    "INSERT INTO login_codes (id, email, code, expires_at, used) VALUES (?, ?, ?, ?, 0)",
  ).run(newId(), email, code, expiresAt);

  let delivery;
  try {
    ({ delivery } = await sendLoginCode(email, code));
  } catch (error) {
    // The provider's own error text is no use to the person signing in, so it
    // goes to the server log and they get something they can act on.
    console.error("[login] Could not send the sign-in code:", error);
    return jsonError("We could not send your code right now. Please try again shortly.", 502);
  }

  if (delivery === "console" && process.env.NODE_ENV === "production") {
    console.error("[login] No email provider is configured — see src/lib/mailer.ts.");
    return jsonError(
      "Email sign-in is not available on this server yet. Please use Google sign-in.",
      503,
    );
  }

  return NextResponse.json({
    ok: true,
    // Shown on the login page only when nothing was actually emailed.
    ...(delivery === "console" ? { devCode: code } : {}),
  });
}
