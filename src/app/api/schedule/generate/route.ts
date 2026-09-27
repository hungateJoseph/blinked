/**
 * POST /api/schedule/generate  { rangeStart, rangeEnd, preferences }
 *
 * Builds a proposed availability schedule from the photographer's booked
 * dates and preferences, saves it as a draft, and returns it for review.
 * Uses Claude when an API key is configured, otherwise the rule-based
 * generator — the response shape is identical either way.
 */
import { NextResponse } from "next/server";
import { AiError, generateScheduleWithAi, isAiConfigured } from "@/lib/ai";
import { jsonError, readJson, unauthorized } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { eachDay, isIsoDate } from "@/lib/dates";
import { generateScheduleByRules, normalizePreferences } from "@/lib/schedule";
import { listBookingsForScheduling, saveDraft } from "@/lib/scheduleStore";

const MAX_RANGE_DAYS = 366;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = await readJson(request);
  const { rangeStart, rangeEnd } = body;
  if (!isIsoDate(rangeStart) || !isIsoDate(rangeEnd) || rangeEnd < rangeStart) {
    return jsonError("Please choose a valid start and end date.");
  }
  if (eachDay(rangeStart, rangeEnd).length > MAX_RANGE_DAYS) {
    return jsonError(`Please keep the planning window to ${MAX_RANGE_DAYS} days or fewer.`);
  }
  const preferences = normalizePreferences(body.preferences);

  const bookings = listBookingsForScheduling(user.id);

  try {
    const draft = isAiConfigured()
      ? await generateScheduleWithAi({ bookings, preferences, rangeStart, rangeEnd })
      : generateScheduleByRules(bookings, preferences, rangeStart, rangeEnd);

    const schedule = saveDraft(user.id, draft, preferences);
    return NextResponse.json({ schedule });
  } catch (error) {
    if (error instanceof AiError) return jsonError(error.message, 502);
    throw error;
  }
}
