/**
 * GET  /api/bookings            — the signed-in photographer's booked dates
 * POST /api/bookings { date, label } — add one
 */
import { NextResponse } from "next/server";
import { jsonError, readJson, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { isIsoDate } from "@/lib/dates";
import { PART_LABELS, parseParts } from "@/lib/parts";
import { addBooking, bookingToView, listBookings } from "@/lib/scheduleStore";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  return NextResponse.json({ bookings: listBookings(user.id).map(bookingToView) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = await readJson(request);
  if (!isIsoDate(body.date)) {
    return jsonError("Please choose a valid date.");
  }
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 120) : "";
  // An unspecified or unrecognisable list means the whole day — the common
  // case for a wedding, and the safe assumption when it is ambiguous.
  const parts = parseParts(body.parts);

  const result = addBooking(user.id, body.date, parts, label);
  if ("conflict" in result) {
    const names = result.conflict.map((p) => PART_LABELS[p].toLowerCase()).join(" and ");
    return jsonError(`You already have a booking that ${names} on that date.`, 409);
  }
  return NextResponse.json({ booking: result.booking }, { status: 201 });
}
