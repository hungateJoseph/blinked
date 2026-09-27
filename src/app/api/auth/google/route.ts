/**
 * POST /api/auth/google  { credential }
 *
 * The browser sends the ID token it received from Google's sign-in widget.
 * We verify it, find or create the matching account, and set the session cookie.
 */
import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api";
import { createSession, findOrCreateUser } from "@/lib/auth";
import { verifyGoogleIdToken } from "@/lib/google";

export async function POST(request: Request) {
  const body = await readJson(request);
  const credential = body.credential;
  if (typeof credential !== "string" || credential.length === 0) {
    return jsonError("Missing Google credential.");
  }

  let profile;
  try {
    profile = await verifyGoogleIdToken(credential);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Google sign-in failed.", 401);
  }

  const user = findOrCreateUser({ ...profile, provider: "google" });
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
