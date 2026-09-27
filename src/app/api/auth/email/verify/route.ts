/**
 * POST /api/auth/email/verify  { email, code }
 *
 * Step two of email sign-in: check the one-time code, then log the user in.
 */
import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api";
import { createSession, findOrCreateUser } from "@/lib/auth";
import { getDb, type LoginCodeRow } from "@/lib/db";
import { looksLikeEmail, nowIso } from "@/lib/util";

export async function POST(request: Request) {
  const body = await readJson(request);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!looksLikeEmail(email) || !/^\d{6}$/.test(code)) {
    return jsonError("Please enter your email and the 6-digit code.");
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM login_codes
       WHERE email = ? AND code = ? AND used = 0 AND expires_at > ?
       ORDER BY expires_at DESC LIMIT 1`,
    )
    .get(email, code, nowIso()) as LoginCodeRow | undefined;

  if (!row) {
    return jsonError("That code is wrong or has expired. Request a new one.", 401);
  }

  db.prepare("UPDATE login_codes SET used = 1 WHERE id = ?").run(row.id);

  const user = findOrCreateUser({ email, provider: "email" });
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
