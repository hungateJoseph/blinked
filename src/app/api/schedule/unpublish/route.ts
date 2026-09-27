/**
 * POST /api/schedule/unpublish
 *
 * Takes the photographer's public availability page down. Anyone holding the
 * link then sees "No availability published yet" instead of open dates.
 *
 * Bookings and past schedules are untouched — this only stops the current one
 * being shown publicly, and publishing again later is a normal generate-and-
 * finalize.
 */
import { NextResponse } from "next/server";
import { jsonError, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { unpublishSchedule } from "@/lib/scheduleStore";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  if (!unpublishSchedule(user.id)) {
    return jsonError("You do not have a published schedule to take down.", 404);
  }
  return NextResponse.json({ ok: true });
}
