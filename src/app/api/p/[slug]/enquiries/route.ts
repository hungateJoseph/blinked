/**
 * POST /api/p/:slug/enquiries
 *
 * The only endpoint in Blinked that anonymous visitors can write to. A couple
 * finds a photographer's availability page, sees an open date and asks about
 * it — without making an account, which would be a silly thing to ask of
 * someone who just wants to send one message.
 *
 * Being public, it is defended three ways: a hidden honeypot field that only
 * an automated filler completes, a rate limit per address, and strict
 * validation with hard length caps. None of these is airtight on its own; the
 * combination stops the casual spam that finds every open form eventually.
 */
import { NextResponse } from "next/server";
import { jsonError, readJson } from "@/lib/api";
import { getDb, type UserRow } from "@/lib/db";
import { addEnquiry, parseEnquiry } from "@/lib/enquiries";
import { sendEnquiryNotification } from "@/lib/mailer";
import { clientAddress, rateLimit } from "@/lib/rateLimit";

/** Per address: a handful an hour is plenty for a real person. */
const LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const user = getDb().prepare("SELECT * FROM users WHERE public_slug = ?").get(slug) as
    | UserRow
    | undefined;
  if (!user) return jsonError("That photographer could not be found.", 404);

  const body = await readJson(request);

  // The form renders a field no human can see. Anything in it came from a bot,
  // so accept the request and do nothing — telling a spammer it failed only
  // teaches them to try harder.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const limit = rateLimit(`enquiry:${clientAddress(request)}`, LIMIT, WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "You have sent several messages already. Please try again a little later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const parsed = parseEnquiry(body);
  if ("error" in parsed) return jsonError(parsed.error);

  const enquiry = addEnquiry(user.id, parsed.enquiry);

  // Told about, but never blocked by, the email: the message is already safely
  // stored, so a mail provider having a bad day must not lose a couple's
  // enquiry or show them an error.
  try {
    await sendEnquiryNotification(user.email, user.public_slug, enquiry);
  } catch (error) {
    console.error("[enquiry] Could not send the notification email:", error);
  }

  return NextResponse.json({ ok: true });
}
