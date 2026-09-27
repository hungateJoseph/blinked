/**
 * DELETE /api/bookings/:id — remove one booked date.
 */
import { NextResponse } from "next/server";
import { jsonError, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { deleteBooking } from "@/lib/scheduleStore";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await params;
  if (!deleteBooking(user.id, id)) {
    return jsonError("Booking not found.", 404);
  }
  return NextResponse.json({ ok: true });
}
