/**
 * GET /api/schedule — the current draft (awaiting review) and the published
 * final schedule, either of which may be null.
 */
import { NextResponse } from "next/server";
import { unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { getLatestSchedule } from "@/lib/scheduleStore";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  return NextResponse.json({
    draft: getLatestSchedule(user.id, "draft"),
    final: getLatestSchedule(user.id, "final"),
  });
}
