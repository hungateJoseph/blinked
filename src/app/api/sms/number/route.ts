/**
 * The photographer's mobile for texting.
 *
 * GET    /api/sms/number          — status: the number (masked), verified or pending, the number to text
 * POST   /api/sms/number {number} — text a six-digit code to it
 * PUT    /api/sms/number {code}   — confirm the code
 * DELETE /api/sms/number          — forget the number
 *
 * Without a texting provider the code goes to the server console and, in
 * development only, back to the page — the same arrangement as email sign-in.
 */
import { NextResponse } from "next/server";
import { jsonError, readJson, unauthorized } from "@/lib/api";
import {
  confirmVerification,
  removeNumber,
  smsStatus,
  startVerification,
} from "@/lib/assistant/smsStore";
import { getCurrentUser } from "@/lib/auth";
import { clientAddress, rateLimit } from "@/lib/rateLimit";
import { maskPhone, normalisePhone, sendSms, smsEnabled, smsFromNumber } from "@/lib/sms";

function statusFor(userId: string) {
  const status = smsStatus(userId);
  return {
    enabled: smsEnabled() || process.env.NODE_ENV !== "production",
    configured: smsEnabled(),
    number: status.number ? maskPhone(status.number) : null,
    verified: status.verified,
    pending: status.pending,
    textTo: smsFromNumber(),
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return NextResponse.json(statusFor(user.id));
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!smsEnabled() && process.env.NODE_ENV === "production") {
    return jsonError("Texting is not set up on this server yet.", 503);
  }
  const slot = rateLimit(`sms-verify:${clientAddress(request)}`, 10, 60 * 60 * 1000);
  if (!slot.allowed) return jsonError("Too many codes requested. Try again later.", 429);

  const body = await readJson(request);
  const number = typeof body.number === "string" ? normalisePhone(body.number) : null;
  if (!number) return jsonError("Please enter a mobile number, e.g. (555) 123-4567 or +44 7700 900123.");

  const started = startVerification(user.id, number);
  if (!started.ok) return jsonError(started.error, started.status);

  let delivery;
  try {
    ({ delivery } = await sendSms(number, `Your Blinked code is ${started.code}. It expires in 10 minutes.`));
  } catch (error) {
    console.error("[sms] Could not send the verification code:", error);
    return jsonError("We could not text that number right now. Check it and try again.", 502);
  }
  return NextResponse.json({
    ...statusFor(user.id),
    // Only when nothing was actually texted, and never in production.
    ...(delivery === "console" && process.env.NODE_ENV !== "production" ? { devCode: started.code } : {}),
  });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const body = await readJson(request);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!/^\d{6}$/.test(code)) return jsonError("The code is six digits.");
  const result = confirmVerification(user.id, code);
  if (!result.ok) return jsonError(result.error);
  return NextResponse.json(statusFor(user.id));
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  removeNumber(user.id);
  return NextResponse.json(statusFor(user.id));
}
